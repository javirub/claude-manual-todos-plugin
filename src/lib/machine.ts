/**
 * Which computer this is.
 *
 * Needed the moment a project's checkouts stop being the only record of it: a row
 * that says "/home/me/Proyectos/costia" is true here and meaningless on the
 * laptop, and something has to be able to tell the two apart.
 *
 * The identifier is generated once and kept in a file, not derived from the
 * machine. Hostnames change and get reused, MAC addresses belong to interfaces
 * rather than computers and move with a dock, and /etc/machine-id exists on
 * neither macOS nor Windows. A random identifier is stable, portable, and says
 * nothing about anyone.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { hostname, platform } from "node:os";
import { join } from "node:path";

import type { Sqlite } from "./db/driver";
import { stateDir } from "./db/paths";
import { nowIso } from "./db/util";
import { atomicWrite } from "./fs";

interface MachineFile {
  id: string;
  label: string;
  createdAt: string;
}

let cached: MachineFile | null = null;

function machineFilePath(): string {
  return join(stateDir(), "machine.json");
}

function read(): MachineFile | null {
  try {
    const value = JSON.parse(readFileSync(machineFilePath(), "utf8"));
    if (typeof value.id !== "string" || !value.id) return null;
    return {
      id: value.id,
      label: typeof value.label === "string" && value.label ? value.label : hostname(),
      createdAt: typeof value.createdAt === "string" ? value.createdAt : nowIso(),
    };
  } catch {
    return null;
  }
}

function load(): MachineFile {
  if (cached) return cached;
  const existing = read();
  if (existing) {
    cached = existing;
    return existing;
  }
  const created: MachineFile = { id: randomUUID(), label: hostname(), createdAt: nowIso() };
  atomicWrite(machineFilePath(), JSON.stringify(created, null, 2) + "\n");
  cached = created;
  return created;
}

export function machineId(): string {
  return load().id;
}

export function machineLabel(): string {
  return load().label;
}

/** Rename this machine, for when `hostname` is a serial number nobody recognises. */
export function setMachineLabel(label: string): void {
  const current = load();
  const next = { ...current, label: label.trim() || hostname() };
  atomicWrite(machineFilePath(), JSON.stringify(next, null, 2) + "\n");
  cached = next;
}

/**
 * Record this machine, and adopt the path rows written before machines existed.
 *
 * The adoption is the migration that migration 4 could not do in SQL. It is safe
 * to run every time: only rows with no machine at all are claimed, and on a
 * database that has never seen a second machine those rows are all ours by
 * definition.
 */
export function registerMachine(db: Sqlite): string {
  const { id, label, createdAt } = load();
  const now = nowIso();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO machines(id, label, os, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, last_seen_at = excluded.last_seen_at`,
    ).run(id, label, platform(), createdAt, now);
    db.prepare("UPDATE project_paths SET machine_id = ? WHERE machine_id IS NULL").run(id);
  });
  return id;
}

/**
 * Has this identity been seen under another hostname?
 *
 * Copying both the data and the state directory to a second computer clones the
 * identity, and then two machines claim each other's checkouts. It is cheap to
 * notice and impossible to guess at afterwards.
 */
export function looksCloned(db: Sqlite): boolean {
  const row = db
    .prepare("SELECT label FROM machines WHERE id = ?")
    .get<{ label: string }>(machineId());
  return !!row && row.label !== machineLabel() && row.label !== hostname();
}

/** Only for tests: forget the cached file so a new state directory is read. */
export function resetMachineCache(): void {
  cached = null;
}

export function machineFileExists(): boolean {
  return existsSync(machineFilePath());
}
