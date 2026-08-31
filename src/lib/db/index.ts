import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { openSqlite, type Sqlite } from "./driver";
import { databasePath } from "./paths";
import { MIGRATION_1, MIGRATION_2 } from "./schema";

const MIGRATIONS: readonly string[] = [MIGRATION_1, MIGRATION_2];

/** What `PRAGMA user_version` should read once a database is up to date. */
export const LATEST_VERSION = MIGRATIONS.length;

/**
 * Applies every migration the file has not seen yet, tracked in SQLite's own
 * `user_version`. Two processes can race here on a fresh install, so the whole
 * thing runs inside an exclusive transaction and re-reads the version once it
 * holds the write lock.
 */
export function migrate(db: Sqlite): number {
  return db.transaction(() => {
    let version = Number(
      (db.prepare("PRAGMA user_version").get<{ user_version: number }>()?.user_version ?? 0),
    );
    for (; version < MIGRATIONS.length; version += 1) {
      db.exec(MIGRATIONS[version]);
    }
    // PRAGMA does not take bound parameters; version is a loop counter, not input.
    db.exec(`PRAGMA user_version = ${version}`);
    return version;
  });
}

export function connect(filename: string = databasePath()): Sqlite {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = openSqlite(filename);

  // WAL is what lets the MCP server write while the board reads. busy_timeout
  // turns the resulting lock contention from an SQLITE_BUSY throw into a wait.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");

  migrate(db);
  return db;
}

// Next keeps module state across hot reloads in dev; without the global we would
// leak a file handle on every edit.
const globalForDb = globalThis as unknown as { __tasksDb?: Sqlite };

export function getDb(): Sqlite {
  if (!globalForDb.__tasksDb) globalForDb.__tasksDb = connect();
  return globalForDb.__tasksDb;
}

export type { Sqlite } from "./driver";
