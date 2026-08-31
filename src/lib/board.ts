import { getDb } from "@/lib/db";
import { getLocale, type Locale } from "@/lib/db/settings";
import { listOwners, listProjects } from "@/lib/db/projects";
import { getTask, listTasks } from "@/lib/db/tasks";
import type { Owner, Project, Task, TaskState, TaskSummary } from "@/lib/db/types";
import type { BoardParams } from "@/lib/url";

/** Everything a board page needs, assembled once so the panes stay dumb. */
export interface BoardData {
  projects: Project[];
  active: Project | null;
  tasks: TaskSummary[];
  counts: { open: number; done: number; all: number };
  owners: Owner[];
  selected: Task | null;
  /** Distinct across every project — a transversal task is one task, not two. */
  totals: { open: number; overdue: number };
  locale: Locale;
}

export function loadBoard(params: BoardParams, activeSlug?: string): BoardData {
  const db = getDb();
  const projects = listProjects(db);
  const active = activeSlug ? (projects.find((p) => p.slug === activeSlug) ?? null) : null;

  const base = {
    projectId: active?.id,
    ownerSlug: params.owner,
    query: params.q,
  };

  const state = (params.state ?? "open") as TaskState | "all";
  const tasks = listTasks(db, { ...base, state });

  // The segment counts carry the owner and search filters, so switching between
  // Pendientes and Completadas never silently drops the rest of the filter.
  const counts = {
    open: listTasks(db, { ...base, state: "open" }).length,
    done: listTasks(db, { ...base, state: "done" }).length,
    all: listTasks(db, { ...base, state: "all" }).length,
  };

  const owners = active
    ? listOwners(db, active.id)
    : projects.flatMap((p) => listOwners(db, p.id)).filter(
        (owner, index, all) => all.findIndex((o) => o.slug === owner.slug) === index,
      );

  // The detail pane is where the work happens, so it is never left blank when
  // there is something to show: an unaddressed link falls back to the first task
  // in the list the user is already looking at.
  const selected =
    (params.task ? getTask(db, params.task) : null) ?? (tasks.length ? getTask(db, tasks[0].id) : null);

  const allOpen = listTasks(db, { state: "open" });
  const now = new Date().toISOString();
  const totals = {
    open: allOpen.length,
    overdue: allOpen.filter((t) => t.dueAt !== null && t.dueAt < now).length,
  };

  return { projects, active, tasks, counts, owners, selected, totals, locale: getLocale(db) };
}
