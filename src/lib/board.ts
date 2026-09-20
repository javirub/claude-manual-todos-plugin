import { getLocalState, getStore } from "@/lib/core";
import type { Locale } from "@/lib/db/settings";
import type { Owner, Project, Task, TaskState, TaskSummary } from "@/lib/core/types";
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
  /** Whether the active project shows in the status bar; `null` with no active project. */
  statusline: boolean | null;
}

export async function loadBoard(params: BoardParams, activeSlug?: string): Promise<BoardData> {
  const store = getStore();
  const local = getLocalState();
  const projects = await store.listProjects();
  const active = activeSlug ? (projects.find((p) => p.slug === activeSlug) ?? null) : null;

  const base = {
    projectId: active?.id,
    ownerSlug: params.owner,
    query: params.q,
  };

  const state = (params.state ?? "open") as TaskState | "all";
  const tasks = await store.listTasks({ ...base, state });

  // The segment counts carry the owner and search filters, so switching between
  // Pendientes and Completadas never silently drops the rest of the filter.
  const counts = {
    open: (await store.listTasks({ ...base, state: "open" })).length,
    done: (await store.listTasks({ ...base, state: "done" })).length,
    all: (await store.listTasks({ ...base, state: "all" })).length,
  };

  const owners = active
    ? await store.listOwners(active.id)
    : (await Promise.all(projects.map((p) => store.listOwners(p.id))))
        .flat()
        .filter((owner, index, all) => all.findIndex((o) => o.slug === owner.slug) === index);

  // The detail pane is where the work happens, so it is never left blank when
  // there is something to show: an unaddressed link falls back to the first task
  // in the list the user is already looking at.
  const selected =
    (params.task ? await store.getTask(params.task) : null) ??
    (tasks.length ? await store.getTask(tasks[0]!.id) : null);

  const allOpen = await store.listTasks({ state: "open" });
  const now = new Date().toISOString();
  const totals = {
    open: allOpen.length,
    overdue: allOpen.filter((t) => t.dueAt !== null && t.dueAt < now).length,
  };

  return {
    projects,
    active,
    tasks,
    counts,
    owners,
    selected,
    totals,
    locale: await store.getLocale(),
    statusline: active ? local.statuslineEnabledFor(active.slug) : null,
  };
}
