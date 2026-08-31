import type { Sqlite } from "./driver";

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * A deadline the user says out loud is a day, not an instant. "2026-09-03"
 * becomes the last moment of that local day, so a task due today stays in the
 * "today" bucket until midnight instead of going overdue at 00:00.
 */
export function normalizeDue(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999).toISOString();
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Cannot read the date "${input}". Use YYYY-MM-DD or a full ISO date.`);
  }
  return parsed.toISOString();
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "sin-titulo";
}

/** Appends -2, -3… until the slug is free in the given table. */
export function uniqueSlug(db: Sqlite, table: "projects" | "tasks", base: string): string {
  const stmt = db.prepare(`SELECT 1 FROM ${table} WHERE slug = ?`);
  let candidate = slugify(base);
  let n = 2;
  while (stmt.get(candidate)) {
    candidate = `${slugify(base)}-${n}`;
    n += 1;
  }
  return candidate;
}

export function recordEvent(db: Sqlite, kind: string, entity: string, entityId?: number): void {
  db.prepare("INSERT INTO db_events(at, kind, entity, entity_id) VALUES (?,?,?,?)").run(
    nowIso(),
    kind,
    entity,
    entityId ?? null,
  );
  // The board only ever needs the tail; anything older has been consumed.
  db.exec("DELETE FROM db_events WHERE id < (SELECT MAX(id) - 500 FROM db_events)");
}

/** Shortest distance between two hues on the colour wheel, in degrees. */
export function hueDistance(a: number, b: number): number {
  const raw = Math.abs(((a % 360) + 360) % 360 - ((b % 360) + 360) % 360);
  return Math.min(raw, 360 - raw);
}

/**
 * The widest gap in the hue circle, so a new project gets an identity that
 * cannot be mistaken for an existing one at a glance.
 */
export function suggestHue(taken: readonly number[]): number {
  if (taken.length === 0) return 265;
  const sorted = [...taken].map((h) => ((h % 360) + 360) % 360).sort((a, b) => a - b);
  let bestMid = (sorted[0] + 180) % 360;
  let bestGap = -1;
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const next = sorted[(i + 1) % sorted.length];
    const gap = i === sorted.length - 1 ? next + 360 - current : next - current;
    if (gap > bestGap) {
      bestGap = gap;
      bestMid = (current + gap / 2) % 360;
    }
  }
  return Math.round(bestMid);
}
