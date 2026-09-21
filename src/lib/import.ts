/**
 * Rebuilding a project's checkouts on a computer that has never seen them.
 *
 * Planning and doing are separate calls on purpose. Cloning is the one thing here
 * that writes outside our own directories, and it writes a lot of it; the plan is
 * what makes that reviewable before it happens, and it is also what the MCP tool
 * returns so the agent can show the user what it is about to do rather than
 * report it afterwards.
 *
 * Nothing in here ever touches a directory it did not create. A destination that
 * already holds something is reported and stepped around — the cost of guessing
 * wrong there is someone's uncommitted work.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname } from "node:path";

import type { LocalState } from "./core/local-state";
import type { TaskStore } from "./core/port";
import type { Id, Project, ProjectRepo } from "./core/types";
import { checkoutPath, commonAncestor, relativeTo } from "./db/repos";
import { slugify } from "./db/util";
import { cloneRepo, detectRepo, sameRemote } from "./git";

export type ImportAction =
  /** Not here, and we know where to get it. */
  | "clone"
  /** Already here, same repository: register the path and clone nothing. */
  | "adopt"
  /** Already here and already registered. */
  | "present"
  /** Nothing to clone from. */
  | "no-remote"
  /** Something else is in the way. */
  | "occupied"
  /** Not under the project's base directory, so no import can place it. */
  | "unplaced"
  /** Withheld by the server: we are not told the remote, only that it exists. */
  | "no-access";

export interface ImportEntry {
  repo: ProjectRepo;
  action: ImportAction;
  /** Where it goes, when we know. */
  destination: string | null;
  /** Why, in the cases where "why" is the whole answer. */
  note: string | null;
}

export interface ImportPlan {
  project: Project;
  base: string;
  entries: ImportEntry[];
}

function isEmptyDir(path: string): boolean {
  try {
    return readdirSync(path).length === 0;
  } catch {
    return false;
  }
}

/**
 * What importing this project here would do, without doing any of it.
 *
 * `only` narrows to a set of repository keys; `withheld` are the keys the server
 * knows exist but would not describe, which is how a shared project reports the
 * repositories you have no access to without naming their remotes.
 */
export function planImport(
  project: Project,
  repos: ProjectRepo[],
  registeredPaths: string[],
  base: string,
  options: { only?: string[]; withheld?: string[] } = {},
): ImportPlan {
  const wanted = options.only?.length ? new Set(options.only) : null;
  const registered = new Set(registeredPaths);

  const entries: ImportEntry[] = repos
    .filter((repo) => !wanted || wanted.has(repo.key))
    .map((repo): ImportEntry => {
      const destination = checkoutPath(base, repo);

      if (!destination) {
        return {
          repo,
          action: "unplaced",
          destination: null,
          note: "shared between projects, so it has no place under this base. Attach it by hand.",
        };
      }

      if (existsSync(destination) && !isEmptyDir(destination)) {
        const found = detectRepo(destination);
        if (found && sameRemote(found.remoteUrl, repo.remoteUrl)) {
          return registered.has(destination)
            ? { repo, action: "present", destination, note: null }
            : { repo, action: "adopt", destination, note: null };
        }
        return {
          repo,
          action: "occupied",
          destination,
          note: found
            ? `a different repository is checked out there (${found.remoteUrl ?? "no remote"})`
            : "a directory is already there and it is not a git checkout",
        };
      }

      if (!repo.remoteUrl) {
        return {
          repo,
          action: "no-remote",
          destination,
          note: "no remote recorded, so there is nothing to clone from",
        };
      }

      return { repo, action: "clone", destination, note: null };
    });

  for (const key of options.withheld ?? []) {
    entries.push({
      repo: { id: "", projectId: project.id, key, remoteUrl: null, defaultBranch: null, relativePath: null, label: null, role: null },
      action: "no-access",
      destination: null,
      note: "you do not have access to this repository",
    });
  }

  return { project, base, entries: entries.sort((a, b) => a.repo.key.localeCompare(b.repo.key)) };
}

export interface ImportOutcome {
  entry: ImportEntry;
  /** What actually happened, which is the planned action unless the clone failed. */
  result: ImportAction | "failed";
  error: string | null;
}

/** Carries out a plan. Safe to re-run: everything already done becomes `present`. */
export function executeImport(state: LocalState, plan: ImportPlan): ImportOutcome[] {
  state.setProjectBase(plan.project.id, plan.base);

  return plan.entries.map((entry): ImportOutcome => {
    if (entry.action === "adopt" && entry.destination) {
      state.addPath(plan.project.id, {
        path: entry.destination,
        label: entry.repo.label,
        role: entry.repo.role,
        repoId: entry.repo.id,
      });
      return { entry, result: "adopt", error: null };
    }

    if (entry.action !== "clone" || !entry.destination || !entry.repo.remoteUrl) {
      return { entry, result: entry.action, error: entry.note };
    }

    mkdirSync(dirname(entry.destination), { recursive: true });
    const cloned = cloneRepo(entry.repo.remoteUrl, entry.destination, entry.repo.defaultBranch);
    if (!cloned.ok) return { entry, result: "failed", error: cloned.reason };

    state.addPath(plan.project.id, {
      path: entry.destination,
      label: entry.repo.label,
      role: entry.repo.role,
      repoId: entry.repo.id,
    });
    return { entry, result: "clone", error: null };
  });
}

/* -------------------------------------------------------------------- scan */

export interface ScanResult {
  base: string | null;
  repos: Array<{ key: string; path: string; remoteUrl: string | null; branch: string | null; relativePath: string | null }>;
  /** Registered paths that are not git checkouts; left alone, but worth saying. */
  notRepositories: string[];
}

/**
 * Describes a project from the checkouts it already has.
 *
 * This is how an existing `~/Proyectos` becomes portable without anyone typing a
 * remote: every registered path is asked what repository it is, the deepest
 * directory containing all of them becomes the base, and what is left of each
 * path becomes the layout. Run it once per project and the machine you are on
 * stops being the only place the project can exist.
 */
export function scanProject(state: LocalState, project: Project): ScanResult {
  const paths = state.listPaths(project.id).map((p) => p.path);

  const checkouts: Array<{ path: string; remoteUrl: string | null; branch: string | null }> = [];
  const notRepositories: string[] = [];

  for (const path of paths) {
    if (!existsSync(path)) {
      notRepositories.push(path);
      continue;
    }
    const found = detectRepo(path);
    // The toplevel, not the directory we were given: a path registered at
    // `<repo>/frontend` of a monorepo is one checkout, not two.
    if (found) checkouts.push({ path: found.toplevel, remoteUrl: found.remoteUrl, branch: found.branch });
    else notRepositories.push(path);
  }

  const unique = [...new Map(checkouts.map((c) => [c.path, c])).values()];
  const base = commonAncestor(unique.map((c) => c.path));

  const repos = unique.map((checkout) => {
    const relativePath = base ? relativeTo(base, checkout.path) : null;
    return {
      key: slugify(relativePath ?? basename(checkout.path)),
      path: checkout.path,
      remoteUrl: checkout.remoteUrl,
      branch: checkout.branch,
      relativePath,
    };
  });

  if (base) state.setProjectBase(project.id, base);

  return { base, repos, notRepositories };
}

/** Writes what a scan found, and links each existing checkout to its repository. */
export async function applyScan(
  store: TaskStore,
  state: LocalState,
  project: Project,
  scan: ScanResult,
): Promise<number> {
  let written = 0;
  for (const repo of scan.repos) {
    const id: Id = await store.upsertRepo(project.id, {
      key: repo.key,
      remoteUrl: repo.remoteUrl,
      defaultBranch: repo.branch,
      relativePath: repo.relativePath,
    });
    state.addPath(project.id, { path: repo.path, repoId: id });
    written += 1;
  }
  return written;
}
