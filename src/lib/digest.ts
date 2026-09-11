/**
 * One answer to "what is waiting for me here", shared by everything that asks
 * it outside the board: the CLI, the statusline segment and the session hook.
 *
 * They used to be three separate readings of the same tables, which is how a
 * statusline ends up claiming two overdue while the hook says one. There is one
 * count here and three renderings of it.
 */
import { connect } from "@/lib/db";
import { resolveProjectByPath } from "@/lib/db/projects";
import { listTasks } from "@/lib/db/tasks";
import type { Project, ProjectPath, TaskSummary } from "@/lib/db/types";
import { bucketOf } from "@/lib/format/dates";
import { taskLine, taskListText } from "@/lib/format/text";

export interface Digest {
  project: Project;
  path: ProjectPath;
  open: TaskSummary[];
  overdue: number;
  today: number;
  /** Overdue first, then the soonest date, then whatever was created first. */
  mostUrgent: TaskSummary | null;
  /** The cwd is above the registered path, not inside it: nobody attached it yet. */
  viaDescendant: boolean;
}

export function digestFor(cwd: string, db = connect()): Digest | null {
  const resolved = resolveProjectByPath(db, cwd);
  if (!resolved) return null;

  const open = listTasks(db, { projectId: resolved.project.id, state: "open" });
  const overdue = open.filter((t) => bucketOf(t.dueAt) === "overdue").length;
  const today = open.filter((t) => bucketOf(t.dueAt) === "today").length;

  // listTasks already orders by due date then creation, so the head of the list
  // is the answer — no second sort that could disagree with the board's order.
  return {
    project: resolved.project,
    path: resolved.path,
    open,
    overdue,
    today,
    mostUrgent: open[0] ?? null,
    viaDescendant: resolved.viaDescendant ?? false,
  };
}

/**
 * `3 open, 1 overdue` — the shape every rendering below builds on.
 *
 * `noun` is for the renderings that stand on their own; the statusline leaves it
 * out because it sits next to a label that already says what is being counted.
 */
export function countsPhrase(digest: Digest, noun = false): string {
  const n = digest.open.length;
  const head = noun
    ? `${n} open manual task${n === 1 ? "" : "s"}`
    : n === 1
      ? "1 open"
      : `${n} open`;
  const parts = [head];
  if (digest.overdue) parts.push(`${digest.overdue} overdue`);
  else if (digest.today) parts.push(digest.today === 1 ? "1 due today" : `${digest.today} due today`);
  return parts.join(", ");
}

/** The statusline segment. Deliberately short: it shares a line with everything else. */
export function statuslineSegment(digest: Digest): string {
  return `◆ ${digest.project.name} · ${countsPhrase(digest)}`;
}

/** The session hook's single line. */
export function hookLine(digest: Digest, boardUrl: string | null): string {
  const parts = [`${digest.project.name}: ${countsPhrase(digest, true)}.`];
  if (digest.mostUrgent) parts.push(`Most urgent: ${taskLine(digest.mostUrgent)}.`);
  parts.push("Read them with list_tasks before recording anything new;");
  parts.push(boardUrl ? `the board is up at ${boardUrl};` : "/todos:tasks opens the board;");
  // Said out loud because the silence it replaces is what hid the board for a
  // whole session: the directory is not attached, only something below it is.
  if (digest.viaDescendant) {
    parts.push(`this directory is not attached — ${digest.path.path} is, below it. Attach it with add_project_path.`);
  }
  return parts.join(" ");
}

/** The terminal digest, for `todos` and `todos pending`. */
export function terminalDigest(digest: Digest): string {
  const head = `${digest.project.name} — ${countsPhrase(digest, true)}`;
  const where = `${digest.path.path}${digest.path.role ? ` (${digest.path.role})` : ""}`;
  return `${head}\n${where}\n\n${taskListText(digest.open)}`;
}
