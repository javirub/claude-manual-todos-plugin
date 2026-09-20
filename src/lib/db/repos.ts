/**
 * A project's repositories, and where they sit on this machine.
 *
 * The split these two tables make is the point: a repository is the same thing
 * everywhere — a remote, a branch, a place in the project's layout — while a
 * checkout is one directory on one computer and means nothing on any other. Keep
 * them in one table and moving to a second machine loses the only record of what
 * the project is made of.
 */
import { join, relative, resolve, sep } from "node:path";

import type { Sqlite } from "./driver";
import { isWithin } from "./paths";
import { nowIso, recordEvent, slugify } from "./util";

export interface ProjectRepo {
  id: number;
  projectId: number;
  /** Stable across machines, which is what makes it the thing to name in a command. */
  key: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
  /** Where it goes under the project's base directory. NULL for a repo that is not under one. */
  relativePath: string | null;
  label: string | null;
  role: string | null;
}

const REPO_SELECT = `SELECT id, project_id AS projectId, key, remote_url AS remoteUrl,
                            default_branch AS defaultBranch, relative_path AS relativePath,
                            label, role
                     FROM project_repos`;

export function listRepos(db: Sqlite, projectId: number): ProjectRepo[] {
  return db.prepare(`${REPO_SELECT} WHERE project_id = ? ORDER BY key`).all<ProjectRepo>(projectId);
}

export function getRepo(db: Sqlite, projectId: number, key: string): ProjectRepo | null {
  return (
    db.prepare(`${REPO_SELECT} WHERE project_id = ? AND key = ?`).get<ProjectRepo>(projectId, key) ??
    null
  );
}

export interface RepoInput {
  key: string;
  remoteUrl?: string | null;
  defaultBranch?: string | null;
  relativePath?: string | null;
  label?: string | null;
  role?: string | null;
}

/**
 * Records a repository, merging with what is already known.
 *
 * COALESCE rather than overwrite, because the callers know different things: a
 * scan of an existing checkout knows the remote and the branch, an import knows
 * the layout, and a person correcting a label knows neither. Whichever runs last
 * must not blank what the others found.
 */
export function upsertRepo(db: Sqlite, projectId: number, input: RepoInput): number {
  const key = slugify(input.key);
  if (!key) throw new Error("A repository needs a key: a short name that is the same on every machine.");
  const now = nowIso();

  db.prepare(
    `INSERT INTO project_repos(project_id, key, remote_url, default_branch, relative_path, label, role, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(project_id, key) DO UPDATE SET
       remote_url     = COALESCE(excluded.remote_url, project_repos.remote_url),
       default_branch = COALESCE(excluded.default_branch, project_repos.default_branch),
       relative_path  = COALESCE(excluded.relative_path, project_repos.relative_path),
       label          = COALESCE(excluded.label, project_repos.label),
       role           = COALESCE(excluded.role, project_repos.role),
       updated_at     = excluded.updated_at`,
  ).run(
    projectId,
    key,
    input.remoteUrl ?? null,
    input.defaultBranch ?? null,
    input.relativePath ?? null,
    input.label ?? null,
    input.role ?? null,
    now,
    now,
  );

  recordEvent(db, "updated", "project", projectId);
  return getRepo(db, projectId, key)!.id;
}

export function removeRepo(db: Sqlite, projectId: number, key: string): boolean {
  const result = db
    .prepare("DELETE FROM project_repos WHERE project_id = ? AND key = ?")
    .run(projectId, slugify(key));
  if (result.changes) recordEvent(db, "updated", "project", projectId);
  return result.changes > 0;
}

/* ------------------------------------------------------------------- bases */

/** Where a project's repositories live on one machine. */
export function getProjectBase(db: Sqlite, projectId: number, machineId: string): string | null {
  const row = db
    .prepare("SELECT base_path AS basePath FROM project_bases WHERE project_id = ? AND machine_id = ?")
    .get<{ basePath: string }>(projectId, machineId);
  return row?.basePath ?? null;
}

export function setProjectBase(
  db: Sqlite,
  projectId: number,
  machineId: string,
  basePath: string,
): string {
  const base = resolve(basePath);
  db.prepare(
    `INSERT INTO project_bases(project_id, machine_id, base_path, created_at) VALUES (?,?,?,?)
     ON CONFLICT(project_id, machine_id) DO UPDATE SET base_path = excluded.base_path`,
  ).run(projectId, machineId, base, nowIso());
  recordEvent(db, "updated", "project", projectId);
  return base;
}

/* ------------------------------------------------------------------ layout */

/**
 * The deepest directory that contains all of them.
 *
 * This is what turns a list of absolute checkouts into a project's shape: the
 * common ancestor becomes the base, and what remains of each path becomes the
 * layout to recreate elsewhere. One path alone has no common ancestor worth the
 * name — its own parent is the honest answer, not the path itself, or importing
 * would nest the repository inside a directory named after it.
 */
export function commonAncestor(paths: string[]): string | null {
  if (!paths.length) return null;
  const split = paths.map((p) => resolve(p).split(sep));
  let shared = split[0]!;
  for (const parts of split.slice(1)) {
    let i = 0;
    while (i < shared.length && i < parts.length && shared[i] === parts[i]) i += 1;
    shared = shared.slice(0, i);
  }
  // A single path shares everything with itself; its parent is the base.
  if (paths.length === 1) shared = shared.slice(0, -1);
  const base = shared.join(sep);
  return base && base !== sep.repeat(base.length) ? base : null;
}

/** Where a repository goes, given a base. NULL when it is not under one. */
export function checkoutPath(base: string, repo: { relativePath: string | null }): string | null {
  if (!repo.relativePath) return null;
  return join(resolve(base), repo.relativePath);
}

/** The layout a checkout implies, or null when it is not under the base at all. */
export function relativeTo(base: string, path: string): string | null {
  const from = resolve(base);
  const target = resolve(path);
  if (!isWithin(from, target)) return null;
  const rel = relative(from, target);
  return rel === "" ? null : rel.split(sep).join("/");
}
