import type { Sqlite, SqlValue } from "./driver";
import type { Owner, Phase, Step, Task, TaskLink, TaskProjectRef, TaskState, TaskSummary } from "./types";
import { normalizeDue, nowIso, recordEvent, uniqueSlug } from "./util";

export interface StepInput {
  title: string;
  body?: string | null;
  why?: string | null;
  value?: string | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
  owner?: string | null;
  /** Steps Claude already resolved in code arrive done, and stay visible. */
  done?: boolean;
  doneBy?: "user" | "agent";
  phase?: string | null;
}

export interface PhaseInput {
  name: string;
  note?: string | null;
  steps: StepInput[];
}

export interface CreateTaskInput {
  title: string;
  summary?: string | null;
  dueAt?: string | null;
  projectId: number;
  alsoProjectIds?: number[];
  phases?: PhaseInput[];
  steps?: StepInput[];
  createdBy?: "agent" | "user";
  sourcePath?: string | null;
  sourceSession?: string | null;
}

export interface TaskFilter {
  projectId?: number;
  state?: TaskState | "all";
  ownerSlug?: string;
  dueBefore?: string;
  query?: string;
  includeArchived?: boolean;
}

interface TaskRow {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  cancelled_at: string | null;
  created_by: "agent" | "user";
  source_path: string | null;
  state: TaskState;
  total_steps: number;
  done_steps: number;
  completed_at: string | null;
}

const TASK_SELECT = `
  SELECT t.id, t.slug, t.title, t.summary, t.due_at, t.created_at, t.updated_at,
         t.archived_at, t.cancelled_at, t.created_by, t.source_path,
         v.state, v.total_steps, v.done_steps,
         COALESCE(t.completed_at, (SELECT MAX(s.done_at) FROM steps s WHERE s.task_id = t.id)) AS completed_at
  FROM tasks t
  JOIN v_task_state v ON v.task_id = t.id
`;

function projectsOf(db: Sqlite, taskId: number): TaskProjectRef[] {
  return db
    .prepare(
      `SELECT p.id, p.slug, p.name, tp.is_primary, th.hue
       FROM task_projects tp
       JOIN projects p ON p.id = tp.project_id
       JOIN project_themes th ON th.project_id = p.id
       WHERE tp.task_id = ?
       ORDER BY tp.is_primary DESC, p.name COLLATE NOCASE`,
    )
    .all<{ id: number; slug: string; name: string; is_primary: number; hue: number }>(taskId)
    .map((r) => ({ id: r.id, slug: r.slug, name: r.name, isPrimary: r.is_primary === 1, hue: r.hue }));
}

function ownersOf(db: Sqlite, taskId: number): Owner[] {
  return db
    .prepare(
      `SELECT DISTINCT o.id, o.slug, o.label, o.color_hue
       FROM steps s JOIN owners o ON o.id = s.owner_id
       WHERE s.task_id = ? ORDER BY o.label`,
    )
    .all<{ id: number; slug: string; label: string; color_hue: number | null }>(taskId)
    .map((r) => ({ id: r.id, slug: r.slug, label: r.label, colorHue: r.color_hue }));
}

function toSummary(db: Sqlite, row: TaskRow): TaskSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    dueAt: row.due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.state === "done" ? row.completed_at : null,
    state: row.state,
    totalSteps: row.total_steps,
    doneSteps: row.done_steps,
    projects: projectsOf(db, row.id),
    owners: ownersOf(db, row.id),
  };
}

export function listTasks(db: Sqlite, filter: TaskFilter = {}): TaskSummary[] {
  const where: string[] = [];
  const values: Array<string | number> = [];

  if (filter.projectId !== undefined) {
    where.push("EXISTS (SELECT 1 FROM task_projects tp WHERE tp.task_id = t.id AND tp.project_id = ?)");
    values.push(filter.projectId);
  }
  if (filter.state && filter.state !== "all") {
    where.push("v.state = ?");
    values.push(filter.state);
  } else if (!filter.includeArchived) {
    where.push("v.state <> 'archived'");
  }
  if (filter.ownerSlug) {
    where.push("EXISTS (SELECT 1 FROM steps s JOIN owners o ON o.id = s.owner_id WHERE s.task_id = t.id AND o.slug = ?)");
    values.push(filter.ownerSlug);
  }
  if (filter.dueBefore) {
    where.push("t.due_at IS NOT NULL AND t.due_at <= ?");
    values.push(filter.dueBefore);
  }
  if (filter.query) {
    where.push(
      `(t.title LIKE ? OR t.summary LIKE ? OR EXISTS (
         SELECT 1 FROM steps s WHERE s.task_id = t.id AND (s.title LIKE ? OR s.body_md LIKE ?)))`,
    );
    const like = `%${filter.query}%`;
    values.push(like, like, like, like);
  }

  // Dated tasks first, soonest to latest; undated ones after them, newest first.
  // Finished work reads better newest-first, since it is a record, not a queue.
  const order =
    filter.state === "done"
      ? "ORDER BY completed_at DESC, t.updated_at DESC"
      : "ORDER BY (t.due_at IS NULL), t.due_at ASC, t.created_at DESC";

  const sql = `${TASK_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ${order}`;
  return db.prepare(sql).all<TaskRow>(...values).map((row) => toSummary(db, row));
}

function stepsOf(db: Sqlite, taskId: number): Step[] {
  return db
    .prepare(
      `SELECT s.id, s.phase_id, s.position, s.title, s.body_md, s.why, s.value, s.link_url, s.link_label,
              s.done_at, s.done_by, o.id AS owner_id, o.slug AS owner_slug, o.label AS owner_label, o.color_hue
       FROM steps s LEFT JOIN owners o ON o.id = s.owner_id
       WHERE s.task_id = ? ORDER BY s.position`,
    )
    .all<{
      id: number;
      phase_id: number | null;
      position: number;
      title: string;
      body_md: string | null;
      why: string | null;
      value: string | null;
      link_url: string | null;
      link_label: string | null;
      done_at: string | null;
      done_by: "user" | "agent" | null;
      owner_id: number | null;
      owner_slug: string | null;
      owner_label: string | null;
      color_hue: number | null;
    }>(taskId)
    .map((r) => ({
      id: r.id,
      phaseId: r.phase_id,
      position: r.position,
      title: r.title,
      bodyMd: r.body_md,
      why: r.why,
      value: r.value,
      linkUrl: r.link_url,
      linkLabel: r.link_label,
      owner: r.owner_id
        ? { id: r.owner_id, slug: r.owner_slug!, label: r.owner_label!, colorHue: r.color_hue }
        : null,
      doneAt: r.done_at,
      doneBy: r.done_by,
    }));
}

function linksOf(db: Sqlite, taskId: number): TaskLink[] {
  const rows = db
    .prepare(
      `SELECT l.kind, l.from_task_id, l.to_task_id, t.id, t.slug, t.title, v.state
       FROM task_links l
       JOIN tasks t ON t.id = CASE WHEN l.from_task_id = ? THEN l.to_task_id ELSE l.from_task_id END
       JOIN v_task_state v ON v.task_id = t.id
       WHERE l.from_task_id = ? OR l.to_task_id = ?`,
    )
    .all<{
      kind: TaskLink["kind"];
      from_task_id: number;
      id: number;
      slug: string;
      title: string;
      state: TaskState;
    }>(taskId, taskId, taskId);
  return rows.map((r) => ({
    kind: r.kind,
    direction: r.from_task_id === taskId ? "outgoing" : "incoming",
    task: { id: r.id, slug: r.slug, title: r.title, state: r.state },
  }));
}

export function getTask(db: Sqlite, ref: string | number): Task | null {
  const row =
    typeof ref === "number"
      ? db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get<TaskRow>(ref)
      : db.prepare(`${TASK_SELECT} WHERE t.slug = ?`).get<TaskRow>(ref);
  if (!row) return null;

  const steps = stepsOf(db, row.id);
  const phases: Phase[] = db
    .prepare("SELECT id, position, name, note FROM phases WHERE task_id = ? ORDER BY position")
    .all<{ id: number; position: number; name: string; note: string | null }>(row.id)
    .map((p) => ({ ...p, steps: steps.filter((s) => s.phaseId === p.id) }));

  return {
    ...toSummary(db, row),
    archivedAt: row.archived_at,
    cancelledAt: row.cancelled_at,
    createdBy: row.created_by,
    sourcePath: row.source_path,
    phases,
    looseSteps: steps.filter((s) => s.phaseId === null),
    links: linksOf(db, row.id),
  };
}

function nextPosition(db: Sqlite, taskId: number): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(position), 0) AS p FROM steps WHERE task_id = ?")
    .get<{ p: number }>(taskId);
  return (row?.p ?? 0) + 1;
}

function ownerIdFor(db: Sqlite, projectId: number, slug: string | null | undefined): number | null {
  if (!slug) return null;
  const existing = db
    .prepare("SELECT id FROM owners WHERE (project_id IS ? OR project_id IS NULL) AND slug = ?")
    .get<{ id: number }>(projectId, slug);
  if (existing) return existing.id;
  // An owner the caller has not declared is created rather than rejected: the
  // vocabulary of a project grows as the work does.
  const { lastInsertRowid } = db
    .prepare("INSERT INTO owners(project_id, slug, label, color_hue) VALUES (?,?,?,NULL)")
    .run(projectId, slug, slug);
  return lastInsertRowid;
}

function insertStep(
  db: Sqlite,
  taskId: number,
  projectId: number,
  phaseId: number | null,
  input: StepInput,
): number {
  const now = nowIso();
  const done = input.done ?? false;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO steps(task_id, phase_id, position, title, body_md, why, value, link_url, link_label,
                         owner_id, done_at, done_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      taskId,
      phaseId,
      nextPosition(db, taskId),
      input.title,
      input.body ?? null,
      input.why ?? null,
      input.value ?? null,
      input.linkUrl ?? null,
      input.linkLabel ?? null,
      ownerIdFor(db, projectId, input.owner),
      done ? now : null,
      done ? (input.doneBy ?? "agent") : null,
      now,
      now,
    );
  return lastInsertRowid;
}

export function createTask(db: Sqlite, input: CreateTaskInput): Task {
  return db.transaction(() => {
    const now = nowIso();
    const slug = uniqueSlug(db, "tasks", input.title);
    const { lastInsertRowid: taskId } = db
      .prepare(
        `INSERT INTO tasks(slug, title, summary, due_at, created_at, updated_at, created_by, source_path, source_session)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        slug,
        input.title,
        input.summary ?? null,
        normalizeDue(input.dueAt),
        now,
        now,
        input.createdBy ?? "agent",
        input.sourcePath ?? null,
        input.sourceSession ?? null,
      );

    db.prepare("INSERT INTO task_projects(task_id, project_id, is_primary) VALUES (?,?,1)").run(
      taskId,
      input.projectId,
    );
    for (const extra of input.alsoProjectIds ?? []) {
      if (extra === input.projectId) continue;
      db.prepare("INSERT OR IGNORE INTO task_projects(task_id, project_id, is_primary) VALUES (?,?,0)").run(
        taskId,
        extra,
      );
    }

    let phasePosition = 0;
    for (const phase of input.phases ?? []) {
      phasePosition += 1;
      const { lastInsertRowid: phaseId } = db
        .prepare("INSERT INTO phases(task_id, position, name, note) VALUES (?,?,?,?)")
        .run(taskId, phasePosition, phase.name, phase.note ?? null);
      for (const step of phase.steps) insertStep(db, taskId, input.projectId, phaseId, step);
    }
    for (const step of input.steps ?? []) insertStep(db, taskId, input.projectId, null, step);

    recordEvent(db, "created", "task", taskId);
    return getTask(db, taskId)!;
  });
}

function touch(db: Sqlite, taskId: number): void {
  db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(nowIso(), taskId);
  recordEvent(db, "updated", "task", taskId);
}

export function addSteps(
  db: Sqlite,
  taskId: number,
  steps: StepInput[],
  phaseName?: string | null,
): Task {
  return db.transaction(() => {
    const primary = db
      .prepare("SELECT project_id FROM task_projects WHERE task_id = ? AND is_primary = 1")
      .get<{ project_id: number }>(taskId);
    if (!primary) throw new Error(`Task ${taskId} does not exist.`);

    let phaseId: number | null = null;
    if (phaseName) {
      const existing = db
        .prepare("SELECT id FROM phases WHERE task_id = ? AND name = ?")
        .get<{ id: number }>(taskId, phaseName);
      phaseId =
        existing?.id ??
        db
          .prepare(
            `INSERT INTO phases(task_id, position, name)
             VALUES (?, (SELECT COALESCE(MAX(position),0)+1 FROM phases WHERE task_id = ?), ?)`,
          )
          .run(taskId, taskId, phaseName).lastInsertRowid;
    }

    for (const step of steps) insertStep(db, taskId, primary.project_id, phaseId, step);
    touch(db, taskId);
    return getTask(db, taskId)!;
  });
}

export function updateStep(
  db: Sqlite,
  stepId: number,
  patch: Partial<Omit<StepInput, "done" | "doneBy" | "phase">>,
): void {
  const columns: Array<[keyof typeof patch, string]> = [
    ["title", "title"],
    ["body", "body_md"],
    ["why", "why"],
    ["value", "value"],
    ["linkUrl", "link_url"],
    ["linkLabel", "link_label"],
  ];
  const sets: string[] = [];
  const values: SqlValue[] = [];
  for (const [key, column] of columns) {
    const value = patch[key];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      values.push(value as string | null);
    }
  }
  if (patch.owner !== undefined) {
    const owned = db
      .prepare(
        `SELECT tp.project_id FROM steps s
         JOIN task_projects tp ON tp.task_id = s.task_id AND tp.is_primary = 1
         WHERE s.id = ?`,
      )
      .get<{ project_id: number }>(stepId);
    sets.push("owner_id = ?");
    values.push(owned ? ownerIdFor(db, owned.project_id, patch.owner) : null);
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  values.push(nowIso());
  db.prepare(`UPDATE steps SET ${sets.join(", ")} WHERE id = ?`).run(...values, stepId);

  const task = db.prepare("SELECT task_id FROM steps WHERE id = ?").get<{ task_id: number }>(stepId);
  if (task) touch(db, task.task_id);
}

export function setStepsDone(db: Sqlite, stepIds: number[], done: boolean, by: "user" | "agent"): number[] {
  if (!stepIds.length) return [];
  return db.transaction(() => {
    const now = nowIso();
    const touched = new Set<number>();
    for (const id of stepIds) {
      const row = db.prepare("SELECT task_id FROM steps WHERE id = ?").get<{ task_id: number }>(id);
      if (!row) continue;
      db.prepare("UPDATE steps SET done_at = ?, done_by = ?, updated_at = ? WHERE id = ?").run(
        done ? now : null,
        done ? by : null,
        now,
        id,
      );
      touched.add(row.task_id);
    }
    for (const taskId of touched) touch(db, taskId);
    return [...touched];
  });
}

export function setTaskDone(db: Sqlite, taskId: number, done: boolean, by: "user" | "agent"): Task {
  return db.transaction(() => {
    const ids = db
      .prepare("SELECT id FROM steps WHERE task_id = ?")
      .all<{ id: number }>(taskId)
      .map((r) => r.id);
    if (ids.length) setStepsDone(db, ids, done, by);
    // A task with no steps has nowhere to record doneness but its own column.
    db.prepare("UPDATE tasks SET completed_at = ?, updated_at = ? WHERE id = ?").run(
      done ? nowIso() : null,
      nowIso(),
      taskId,
    );
    recordEvent(db, "updated", "task", taskId);
    return getTask(db, taskId)!;
  });
}

export function updateTask(
  db: Sqlite,
  taskId: number,
  patch: {
    title?: string;
    summary?: string | null;
    dueAt?: string | null;
    archived?: boolean;
    cancelled?: boolean;
    alsoProjectIds?: number[];
  },
): Task {
  return db.transaction(() => {
    const sets: string[] = [];
    const values: SqlValue[] = [];
    if (patch.title !== undefined) (sets.push("title = ?"), values.push(patch.title));
    if (patch.summary !== undefined) (sets.push("summary = ?"), values.push(patch.summary));
    if (patch.dueAt !== undefined) (sets.push("due_at = ?"), values.push(normalizeDue(patch.dueAt)));
    if (patch.archived !== undefined)
      (sets.push("archived_at = ?"), values.push(patch.archived ? nowIso() : null));
    if (patch.cancelled !== undefined)
      (sets.push("cancelled_at = ?"), values.push(patch.cancelled ? nowIso() : null));
    if (sets.length) {
      sets.push("updated_at = ?");
      values.push(nowIso());
      db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values, taskId);
    }
    if (patch.alsoProjectIds) {
      db.prepare("DELETE FROM task_projects WHERE task_id = ? AND is_primary = 0").run(taskId);
      for (const id of patch.alsoProjectIds) {
        db.prepare("INSERT OR IGNORE INTO task_projects(task_id, project_id, is_primary) VALUES (?,?,0)").run(
          taskId,
          id,
        );
      }
    }
    recordEvent(db, "updated", "task", taskId);
    return getTask(db, taskId)!;
  });
}

export function deleteTask(db: Sqlite, taskId: number): void {
  db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
  recordEvent(db, "deleted", "task", taskId);
}

export function deleteStep(db: Sqlite, stepId: number): void {
  const row = db.prepare("SELECT task_id FROM steps WHERE id = ?").get<{ task_id: number }>(stepId);
  db.prepare("DELETE FROM steps WHERE id = ?").run(stepId);
  if (row) touch(db, row.task_id);
}

export function linkTasks(db: Sqlite, fromId: number, toId: number, kind: TaskLink["kind"]): void {
  db.prepare("INSERT OR IGNORE INTO task_links(from_task_id, to_task_id, kind) VALUES (?,?,?)").run(
    fromId,
    toId,
    kind,
  );
  touch(db, fromId);
}
