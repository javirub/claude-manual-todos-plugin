#!/usr/bin/env node
// Opens the tasks database with plain Node and reads it.
//
// Plain JavaScript with no local imports on purpose: the point is to prove the
// data outlives the runtime that wrote it. The board and the MCP server run on
// Bun, but the file they write is ordinary SQLite through `node:sqlite`, so a
// Node with no Bun in sight can still read every task.
//
//   node scripts/db-portability.mjs [path-to-tasks.db]

import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const file =
  process.argv[2] ||
  process.env.CLAUDE_TASKS_DB ||
  join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "claude-tasks", "tasks.db");

const db = new DatabaseSync(file);

const version = db.prepare("PRAGMA user_version").get().user_version;
if (!version) {
  console.error(`${file} has no schema (user_version = ${version}).`);
  process.exit(1);
}

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map((row) => row.name);

for (const required of ["projects", "tasks", "steps", "settings"]) {
  if (!tables.includes(required)) {
    console.error(`${file} is missing the "${required}" table.`);
    process.exit(1);
  }
}

// The derived view is the load-bearing one: if it does not survive the trip,
// "is this task done?" cannot be answered outside Bun.
const state = db.prepare("SELECT COUNT(*) AS n FROM v_task_state").get().n;

console.log(
  `${file}: schema v${version}, ${tables.length} tables, ${state} task(s) readable from Node ${process.version}.`,
);
db.close();
