#!/usr/bin/env bun
/**
 * One line of context at the start of a session: what is already waiting for the
 * user in this project. Silent when there is nothing, or when the directory
 * belongs to no project — a hook that speaks up every time stops being read.
 */
import { connect } from "../src/lib/db";
import { resolveProjectByPath } from "../src/lib/db/projects";
import { listTasks } from "../src/lib/db/tasks";

try {
  const input = await Bun.stdin.text().catch(() => "");
  const payload = input ? (JSON.parse(input) as { cwd?: string }) : {};
  const cwd = payload.cwd || process.cwd();

  const db = connect();
  const resolved = resolveProjectByPath(db, cwd);
  if (!resolved) process.exit(0);

  const open = listTasks(db, { projectId: resolved.project.id, state: "open" });
  if (!open.length) process.exit(0);

  const now = new Date().toISOString();
  const overdue = open.filter((t) => t.dueAt !== null && t.dueAt < now).length;
  const parts = [open.length === 1 ? "1 open manual task" : `${open.length} open manual tasks`];
  if (overdue) parts.push(overdue === 1 ? "1 overdue" : `${overdue} overdue`);

  console.log(
    `${resolved.project.name}: ${parts.join(", ")}. ` +
      `Read them with list_tasks before recording anything new; /tasks opens the board.`,
  );
} catch {
  // A hook that fails must never be the reason a session does not start.
  process.exit(0);
}
