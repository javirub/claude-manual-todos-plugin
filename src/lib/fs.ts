import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

/**
 * Write a file without ever leaving a half-written one behind.
 *
 * Everything this writes is read by something that runs on every session or every
 * status-bar render, and a truncated launcher or a credentials file cut in half is
 * worse than no file at all: the reader cannot tell the difference between "not
 * configured" and "configured, badly". Rename is atomic within a filesystem, so
 * the reader sees either the old contents or the new ones.
 */
export function atomicWrite(path: string, value: string, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, value, { mode });
  renameSync(temporary, path);
}
