/**
 * The one place that knows which SQLite implementation we talk to.
 *
 * `node:sqlite` rather than `bun:sqlite`, deliberately. Bun implements
 * `node:sqlite` on top of the same native SQLite it uses for `bun:sqlite`, so
 * there is nothing to gain from the Bun-specific import, and one thing to lose:
 * `bun:sqlite` is unresolvable from any bundler and from Node, which would mean
 * bundler externals config plus a second code path. A `node:` builtin is
 * externalized by Next automatically and keeps working if the server ever has to
 * run under Node instead of Bun.
 *
 * Only positional (`?`) parameters are used anywhere in this codebase.
 */

import { DatabaseSync } from "node:sqlite";

export type SqlValue = string | number | bigint | boolean | null | Uint8Array;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface Stmt {
  run(...params: SqlValue[]): RunResult;
  get<T = Record<string, unknown>>(...params: SqlValue[]): T | undefined;
  all<T = Record<string, unknown>>(...params: SqlValue[]): T[];
}

export interface Sqlite {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
  transaction<T>(fn: () => T): T;
  close(): void;
}

// SQLite has no boolean type, and an unconverted `true` reaches the bindings as
// something neither driver agrees on.
type BoundValue = Exclude<SqlValue, boolean>;

function normalize(params: SqlValue[]): BoundValue[] {
  return params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
}

export function openSqlite(filename: string): Sqlite {
  const raw = new DatabaseSync(filename);
  let depth = 0;

  return {
    exec: (sql) => raw.exec(sql),

    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        run(...params) {
          const r = stmt.run(...normalize(params));
          return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
        },
        get<T>(...params: SqlValue[]) {
          return stmt.get(...normalize(params)) as T | undefined;
        },
        all<T>(...params: SqlValue[]) {
          return stmt.all(...normalize(params)) as T[];
        },
      };
    },

    // Nested calls join the outer transaction with a savepoint, so a query
    // helper can be transactional on its own and still compose.
    transaction<T>(fn: () => T): T {
      const name = `sp_${depth}`;
      raw.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
      depth += 1;
      try {
        const result = fn();
        depth -= 1;
        raw.exec(depth === 0 ? "COMMIT" : `RELEASE ${name}`);
        return result;
      } catch (error) {
        depth -= 1;
        raw.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}`);
        throw error;
      }
    },

    close: () => raw.close(),
  };
}
