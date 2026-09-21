/**
 * How repositories, import plans and scans read back. Plain text, like the rest
 * of what the tools return — see the note at the top of ./text.
 */
import type { ProjectRepo } from "@/lib/core/types";
import type { ImportAction, ImportEntry, ImportOutcome, ImportPlan, ScanResult } from "@/lib/import";

const ACTION_EN: Record<ImportAction | "failed", string> = {
  clone: "clone",
  adopt: "adopt",
  present: "already here",
  "no-remote": "skip",
  occupied: "skip",
  unplaced: "skip",
  "no-access": "omitted",
  failed: "FAILED",
};

export function repoLine(repo: ProjectRepo, presentAt?: string | null): string {
  const where = repo.relativePath ?? "(not under the project base)";
  const remote = repo.remoteUrl ?? "no remote recorded";
  const here = presentAt ? `\n      here: ${presentAt}` : "\n      not on this machine";
  return `  ${repo.key}  ${where}\n      ${remote}${repo.defaultBranch ? ` (${repo.defaultBranch})` : ""}${here}`;
}

export function repoListText(repos: ProjectRepo[], presentAt: (repo: ProjectRepo) => string | null): string {
  if (!repos.length) {
    return "No repositories recorded. Run `adopt_paths` to describe this project from the checkouts it already has.";
  }
  const missing = repos.filter((r) => !presentAt(r)).length;
  const head = `${repos.length} repositor${repos.length === 1 ? "y" : "ies"}` +
    (missing ? `, ${missing} not on this machine — \`import_project\` clones them.` : ", all present here.");
  return [head, ...repos.map((r) => repoLine(r, presentAt(r)))].join("\n");
}

function entryLine(entry: ImportEntry, result?: ImportAction | "failed", error?: string | null): string {
  const verb = ACTION_EN[result ?? entry.action];
  const where = entry.destination ?? "—";
  const why = error ?? entry.note;
  return `  ${verb.padEnd(12)} ${entry.repo.key.padEnd(18)} ${where}${why ? `\n      ${why}` : ""}`;
}

/**
 * The plan, as something to say yes to.
 *
 * It names every repository it would leave alone as well as the ones it would
 * clone, because "nothing happened to the other four" is exactly the thing
 * someone needs to be told before they agree to it.
 */
export function importPlanText(plan: ImportPlan): string {
  const counts = plan.entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.action] = (acc[e.action] ?? 0) + 1;
    return acc;
  }, {});
  const willClone = counts.clone ?? 0;

  const head =
    willClone > 0
      ? `Importing ${plan.project.name} into ${plan.base} would clone ${willClone} repositor${willClone === 1 ? "y" : "ies"}:`
      : `Nothing to clone for ${plan.project.name} under ${plan.base}.`;

  const summary = Object.entries(counts)
    .map(([action, n]) => `${n} ${ACTION_EN[action as ImportAction]}`)
    .join(", ");

  return [head, ...plan.entries.map((e) => entryLine(e)), "", summary].join("\n");
}

export function importResultText(plan: ImportPlan, outcomes: ImportOutcome[]): string {
  const cloned = outcomes.filter((o) => o.result === "clone").length;
  const adopted = outcomes.filter((o) => o.result === "adopt").length;
  const failed = outcomes.filter((o) => o.result === "failed").length;

  const head =
    `${plan.project.name} under ${plan.base}: ` +
    `${cloned} cloned, ${adopted} adopted, ${outcomes.length - cloned - adopted - failed} untouched` +
    (failed ? `, ${failed} failed` : "");

  return [head, ...outcomes.map((o) => entryLine(o.entry, o.result, o.error))].join("\n");
}

export function scanText(scan: ScanResult, projectName: string): string {
  if (!scan.repos.length) {
    return `No git checkouts among ${projectName}'s registered paths, so there is nothing to describe yet.`;
  }
  const lines = [
    `${projectName}: ${scan.repos.length} repositor${scan.repos.length === 1 ? "y" : "ies"} under ${scan.base}`,
  ];
  for (const repo of scan.repos) {
    lines.push(`  ${repo.key.padEnd(18)} ${repo.relativePath ?? "(outside the base)"}  ${repo.remoteUrl ?? "no remote"}`);
  }
  if (scan.notRepositories.length) {
    lines.push("", "Registered paths that are not git checkouts, left alone:");
    for (const path of scan.notRepositories) lines.push(`  ${path}`);
  }
  return lines.join("\n");
}
