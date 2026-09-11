import { resolve } from "node:path";

import { isWithin } from "./paths";

import type { Sqlite } from "./driver";
import type { Owner, Project, ProjectPath, ProjectRelation, ProjectTheme } from "./types";
import { hueDistance, nowIso, recordEvent, suggestHue, uniqueSlug } from "./util";

/** Two projects whose accents look alike defeat the point of theming them. */
export const MIN_HUE_DISTANCE = 25;

const DEFAULT_THEME: Omit<ProjectTheme, "hue"> = {
  mode: "dark",
  chroma: 0.13,
  neutralChroma: 0.012,
  accent2Hue: null,
  motif: "none",
  fontHeading: "grotesque",
  radius: "soft",
};

interface ProjectRow {
  id: number;
  slug: string;
  name: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  mode: ProjectTheme["mode"];
  hue: number;
  chroma: number;
  neutral_chroma: number;
  accent2_hue: number | null;
  motif: ProjectTheme["motif"];
  font_heading: ProjectTheme["fontHeading"];
  radius: ProjectTheme["radius"];
}

const PROJECT_SELECT = `
  SELECT p.id, p.slug, p.name, p.summary, p.created_at, p.updated_at, p.archived_at,
         t.mode, t.hue, t.chroma, t.neutral_chroma, t.accent2_hue, t.motif, t.font_heading, t.radius
  FROM projects p
  JOIN project_themes t ON t.project_id = p.id
`;

function hydrate(db: Sqlite, row: ProjectRow): Project {
  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN s.state = 'open' THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN s.state = 'done' THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN s.state = 'open' AND t.due_at IS NOT NULL AND t.due_at < ? THEN 1 ELSE 0 END) AS overdue
       FROM task_projects tp
       JOIN tasks t ON t.id = tp.task_id
       JOIN v_task_state s ON s.task_id = t.id
       WHERE tp.project_id = ?`,
    )
    .get<{ open: number | null; done: number | null; overdue: number | null }>(nowIso(), row.id);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    theme: {
      mode: row.mode,
      hue: row.hue,
      chroma: row.chroma,
      neutralChroma: row.neutral_chroma,
      accent2Hue: row.accent2_hue,
      motif: row.motif,
      fontHeading: row.font_heading,
      radius: row.radius,
    },
    paths: listPaths(db, row.id),
    owners: listOwners(db, row.id),
    counts: {
      open: counts?.open ?? 0,
      done: counts?.done ?? 0,
      overdue: counts?.overdue ?? 0,
    },
  };
}

export function listPaths(db: Sqlite, projectId: number): ProjectPath[] {
  return db
    .prepare("SELECT id, path, label, role FROM project_paths WHERE project_id = ? ORDER BY path")
    .all<ProjectPath>(projectId);
}

export function listOwners(db: Sqlite, projectId: number | null): Owner[] {
  const rows = db
    .prepare(
      `SELECT id, slug, label, color_hue FROM owners
       WHERE project_id IS ? OR project_id IS NULL ORDER BY label`,
    )
    .all<{ id: number; slug: string; label: string; color_hue: number | null }>(projectId);
  return rows.map((r) => ({ id: r.id, slug: r.slug, label: r.label, colorHue: r.color_hue }));
}

export function listProjects(db: Sqlite, includeArchived = false): Project[] {
  const rows = db
    .prepare(
      `${PROJECT_SELECT} ${includeArchived ? "" : "WHERE p.archived_at IS NULL"} ORDER BY p.name COLLATE NOCASE`,
    )
    .all<ProjectRow>();
  return rows.map((row) => hydrate(db, row));
}

export function getProject(db: Sqlite, ref: string | number): Project | null {
  const row =
    typeof ref === "number"
      ? db.prepare(`${PROJECT_SELECT} WHERE p.id = ?`).get<ProjectRow>(ref)
      : db.prepare(`${PROJECT_SELECT} WHERE p.slug = ?`).get<ProjectRow>(ref);
  return row ? hydrate(db, row) : null;
}

/**
 * Turns a working directory into a project by longest matching path prefix.
 * That is what makes `costia/frontend`, `costia/backend` and `costia/docs-site`
 * three rows and one project — and what lets a nested checkout claim a cwd back
 * from its parent.
 */
/**
 * `viaDescendant` means the cwd is *above* the registered path rather than inside
 * it, so the answer is an inference and the caller should say so — the directory
 * is not attached yet and `add_project_path` is the fix.
 */
export interface ResolvedProjectPath {
  project: Project;
  path: ProjectPath;
  viaDescendant?: boolean;
}

/**
 * Every project a directory belongs to, most specific first.
 *
 * Plural because a repository can serve several products — one `k3s-cluster`
 * behind three of them, a shared microservice, a design system. Asking for "the"
 * project of a path is the question that cannot always be answered, and answering
 * it anyway is how the board shows you one product's tasks while you work on
 * another's.
 *
 * Direct matches come first, ordered by how specific they are. The inferred ones
 * — a cwd that merely sits above a registered path — come last and are flagged.
 */
export function resolveProjectsByPath(db: Sqlite, cwd: string): ResolvedProjectPath[] {
  const rows = db
    .prepare("SELECT id, project_id, path, label, role FROM project_paths ORDER BY LENGTH(path) DESC")
    .all<{ id: number; project_id: number; path: string; label: string | null; role: string | null }>();

  const found: ResolvedProjectPath[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    if (!isWithin(row.path, cwd) || seen.has(row.project_id)) continue;
    const project = getProject(db, row.project_id);
    if (!project) continue;
    seen.add(row.project_id);
    found.push({ project, path: { id: row.id, path: row.path, label: row.label, role: row.role } });
  }
  if (found.length) return found;

  // See the note below: nothing contains the cwd, so look inside it instead.
  const below = rows.filter((row) => isWithin(cwd, row.path));
  if (!below.length) return [];
  if (new Set(below.map((row) => row.project_id)).size > 1) return [];
  const row = below[below.length - 1]!;
  const project = getProject(db, row.project_id);
  if (!project) return [];
  return [
    {
      project,
      path: { id: row.id, path: row.path, label: row.label, role: row.role },
      viaDescendant: true,
    },
  ];
}

/**
 * The most specific project a directory belongs to, or null.
 *
 * For the callers that genuinely want one answer — the status line has one line.
 * Anything that records or reports should use `resolveProjectsByPath` and say
 * what it found, because "the first of several" is a guess wearing a fact's
 * clothes.
 */
export function resolveProjectByPath(db: Sqlite, cwd: string): ResolvedProjectPath | null {
  const rows = db
    .prepare("SELECT id, project_id, path, label, role FROM project_paths ORDER BY LENGTH(path) DESC")
    .all<{ id: number; project_id: number; path: string; label: string | null; role: string | null }>();

  for (const row of rows) {
    if (isWithin(row.path, cwd)) {
      const project = getProject(db, row.project_id);
      if (project) {
        return { project, path: { id: row.id, path: row.path, label: row.label, role: row.role } };
      }
    }
  }

  /*
   * Nothing registered contains the cwd — but something registered may live
   * *inside* it, and then the session knows perfectly well where it is.
   *
   * This is the superproject case: a repository of submodules where only
   * `<repo>/frontend` was ever attached. Opened at the root, resolution returned
   * null, so the session hook stayed silent and a whole session went by without
   * anyone reading a board that had twelve open tasks on it — including the one
   * that explained the problem being investigated by hand. Silence is the right
   * answer for a directory nobody has ever mentioned; it is the wrong one for
   * the parent of a directory that is attached.
   *
   * Only when every registered path below belongs to the **same** project: at
   * `~/Proyectos` every project is below, and picking one would be arbitrary.
   */
  const below = rows.filter((row) => isWithin(cwd, row.path));
  if (!below.length) return null;
  if (new Set(below.map((row) => row.project_id)).size > 1) return null;

  // `rows` is longest-first, so the last of them is the shallowest — the closest
  // registered path to the cwd, and the most useful one to name.
  const row = below[below.length - 1]!;
  const project = getProject(db, row.project_id);
  if (!project) return null;
  return {
    project,
    path: { id: row.id, path: row.path, label: row.label, role: row.role },
    viaDescendant: true,
  };
}

export function takenHues(db: Sqlite, exceptProjectId?: number): number[] {
  return db
    .prepare(
      `SELECT hue FROM project_themes t JOIN projects p ON p.id = t.project_id
       WHERE p.archived_at IS NULL AND t.project_id IS NOT ?`,
    )
    .all<{ hue: number }>(exceptProjectId ?? null)
    .map((r) => r.hue);
}

export class HueTooCloseError extends Error {
  constructor(
    readonly requested: number,
    readonly clash: { hue: number; name: string },
    readonly suggestion: number,
  ) {
    super(
      `Hue ${Math.round(requested)}° is ${Math.round(hueDistance(requested, clash.hue))}° from ` +
        `"${clash.name}" (${Math.round(clash.hue)}°), and ${MIN_HUE_DISTANCE}° are needed. ` +
        `The widest free gap is at ${suggestion}°.`,
    );
    this.name = "HueTooCloseError";
  }
}

function assertHueIsFree(db: Sqlite, hue: number, exceptProjectId?: number): void {
  const rows = db
    .prepare(
      `SELECT t.hue, p.name FROM project_themes t JOIN projects p ON p.id = t.project_id
       WHERE p.archived_at IS NULL AND t.project_id IS NOT ?`,
    )
    .all<{ hue: number; name: string }>(exceptProjectId ?? null);
  const clash = rows.find((r) => hueDistance(hue, r.hue) < MIN_HUE_DISTANCE);
  if (clash) {
    throw new HueTooCloseError(hue, clash, suggestHue(rows.map((r) => r.hue)));
  }
}

export interface CreateProjectInput {
  name: string;
  slug?: string;
  summary?: string | null;
  paths?: Array<{ path: string; label?: string | null; role?: string | null }>;
  owners?: Array<{ slug: string; label?: string; colorHue?: number | null }>;
  theme?: Partial<ProjectTheme>;
}

export function createProject(db: Sqlite, input: CreateProjectInput): Project {
  return db.transaction(() => {
    const hue = input.theme?.hue ?? suggestHue(takenHues(db));
    assertHueIsFree(db, hue);

    const now = nowIso();
    const slug = uniqueSlug(db, "projects", input.slug || input.name);
    const { lastInsertRowid: id } = db
      .prepare("INSERT INTO projects(slug, name, summary, created_at, updated_at) VALUES (?,?,?,?,?)")
      .run(slug, input.name, input.summary ?? null, now, now);

    const theme = { ...DEFAULT_THEME, ...input.theme, hue };
    db.prepare(
      `INSERT INTO project_themes(project_id, mode, hue, chroma, neutral_chroma, accent2_hue, motif, font_heading, radius)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      theme.mode,
      theme.hue,
      theme.chroma,
      theme.neutralChroma,
      theme.accent2Hue,
      theme.motif,
      theme.fontHeading,
      theme.radius,
    );

    for (const p of input.paths ?? []) addProjectPath(db, id, p);
    for (const o of input.owners ?? []) upsertOwner(db, id, o);

    recordEvent(db, "created", "project", id);
    return getProject(db, id)!;
  });
}

export function addProjectPath(
  db: Sqlite,
  projectId: number,
  input: { path: string; label?: string | null; role?: string | null },
): void {
  db.prepare(
    // The conflict target is the pair, so attaching a path that another project
    // already has adds it here instead of taking it from them.
    `INSERT INTO project_paths(project_id, path, label, role) VALUES (?,?,?,?)
     ON CONFLICT(project_id, path) DO UPDATE SET label = COALESCE(excluded.label, project_paths.label),
                                                 role = COALESCE(excluded.role, project_paths.role)`,
  ).run(projectId, resolve(input.path), input.label ?? null, input.role ?? null);
  recordEvent(db, "updated", "project", projectId);
}

/**
 * Removes one path from a project. There was no way to do this, so a checkout
 * root that moved could only ever accumulate: the paths of the old layout stayed
 * in the table for ever, resolving to nothing and explaining nothing.
 *
 * Returns false when that path was not this project's, so a caller can say so
 * instead of reporting a deletion that did not happen.
 */
export function removeProjectPath(db: Sqlite, projectId: number, path: string): boolean {
  const target = resolve(path);
  const before = db
    .prepare("SELECT COUNT(*) AS n FROM project_paths WHERE project_id = ? AND path = ?")
    .get<{ n: number }>(projectId, target);
  if (!before?.n) return false;

  db.prepare("DELETE FROM project_paths WHERE project_id = ? AND path = ?").run(projectId, target);
  recordEvent(db, "updated", "project", projectId);
  return true;
}

export function upsertOwner(
  db: Sqlite,
  projectId: number,
  input: { slug: string; label?: string; colorHue?: number | null },
): number {
  db.prepare(
    `INSERT INTO owners(project_id, slug, label, color_hue) VALUES (?,?,?,?)
     ON CONFLICT(project_id, slug) DO UPDATE SET label = excluded.label,
                                                 color_hue = COALESCE(excluded.color_hue, owners.color_hue)`,
  ).run(projectId, input.slug, input.label ?? input.slug, input.colorHue ?? null);
  return db
    .prepare("SELECT id FROM owners WHERE project_id IS ? AND slug = ?")
    .get<{ id: number }>(projectId, input.slug)!.id;
}

export function updateProject(
  db: Sqlite,
  projectId: number,
  patch: { name?: string; summary?: string | null; archived?: boolean },
): Project {
  const sets: string[] = [];
  const values: Array<string | null> = [];
  if (patch.name !== undefined) (sets.push("name = ?"), values.push(patch.name));
  if (patch.summary !== undefined) (sets.push("summary = ?"), values.push(patch.summary));
  if (patch.archived !== undefined) (sets.push("archived_at = ?"), values.push(patch.archived ? nowIso() : null));
  if (sets.length) {
    sets.push("updated_at = ?");
    values.push(nowIso());
    db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...values, projectId);
    recordEvent(db, "updated", "project", projectId);
  }
  return getProject(db, projectId)!;
}

export function setProjectTheme(db: Sqlite, projectId: number, patch: Partial<ProjectTheme>): Project {
  if (patch.hue !== undefined) assertHueIsFree(db, patch.hue, projectId);
  const columns: Record<keyof ProjectTheme, string> = {
    mode: "mode",
    hue: "hue",
    chroma: "chroma",
    neutralChroma: "neutral_chroma",
    accent2Hue: "accent2_hue",
    motif: "motif",
    fontHeading: "font_heading",
    radius: "radius",
  };
  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  for (const [key, column] of Object.entries(columns) as Array<[keyof ProjectTheme, string]>) {
    const value = patch[key];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      values.push(value as string | number | null);
    }
  }
  if (sets.length) {
    db.prepare(`UPDATE project_themes SET ${sets.join(", ")} WHERE project_id = ?`).run(...values, projectId);
    recordEvent(db, "updated", "project", projectId);
  }
  return getProject(db, projectId)!;
}

export function linkProjects(
  db: Sqlite,
  fromId: number,
  toId: number,
  kind: ProjectRelation["kind"] = "relates",
  note?: string | null,
): void {
  db.prepare(
    `INSERT INTO project_links(from_project_id, to_project_id, kind, note) VALUES (?,?,?,?)
     ON CONFLICT(from_project_id, to_project_id, kind) DO UPDATE SET note = excluded.note`,
  ).run(fromId, toId, kind, note ?? null);
  recordEvent(db, "updated", "project", fromId);
}

export function listProjectRelations(db: Sqlite, projectId: number): ProjectRelation[] {
  return db
    .prepare(
      `SELECT p.id, p.slug, p.name, l.kind, l.note
       FROM project_links l
       JOIN projects p ON p.id = CASE WHEN l.from_project_id = ? THEN l.to_project_id ELSE l.from_project_id END
       WHERE l.from_project_id = ? OR l.to_project_id = ?`,
    )
    .all<{ id: number; slug: string; name: string; kind: ProjectRelation["kind"]; note: string | null }>(
      projectId,
      projectId,
      projectId,
    )
    .map((r) => ({ project: { id: r.id, slug: r.slug, name: r.name }, kind: r.kind, note: r.note }));
}

/** The widest free slot on the hue circle right now, for a project about to be created. */
export function suggestFreeHue(db: Sqlite): number {
  return suggestHue(takenHues(db));
}
