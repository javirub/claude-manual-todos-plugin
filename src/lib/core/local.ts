/**
 * The port over the SQLite file on this machine.
 *
 * Almost all of it is one line per method. That is the measure of whether the
 * seam was cut in the right place: the local implementation should be a change
 * of vocabulary, not a layer.
 *
 * The only real work is at the edges, turning row numbers into opaque ids and
 * back. `Number(id)` on the way in is safe because the only ids this store ever
 * hands out are its own.
 */
import type { Sqlite } from "@/lib/db/driver";
import { getDb } from "@/lib/db";
import * as projects from "@/lib/db/projects";
import * as repos from "@/lib/db/repos";
import * as tasks from "@/lib/db/tasks";
import * as settings from "@/lib/db/settings";
import type * as row from "@/lib/db/types";

import type {
  CreateProjectInput,
  CreateTaskInput,
  Locale,
  StepInput,
  TaskFilter,
  TaskStore,
  UpdateTaskPatch,
} from "./port";
import type * as dto from "./types";
import type { Id } from "./types";

const out = (id: number): Id => String(id);
const outNull = (id: number | null): Id | null => (id === null ? null : String(id));

/**
 * A reference is either one of our ids or a slug. `Number` is the test rather
 * than a regular expression because that is exactly the question being asked:
 * can the underlying store use this as a row number?
 */
function ref(value: Id | string): string | number {
  const asNumber = Number(value);
  return Number.isInteger(asNumber) && String(asNumber) === value ? asNumber : value;
}

function id(value: Id): number {
  const asNumber = Number(value);
  if (!Number.isInteger(asNumber)) throw new Error(`"${value}" is not an id in this database.`);
  return asNumber;
}

const owner = (o: row.Owner): dto.Owner => ({ ...o, id: out(o.id) });

const path = (p: row.ProjectPath): dto.ProjectPath => ({
  ...p,
  id: out(p.id),
  repoId: outNull(p.repoId),
});

const project = (p: row.Project): dto.Project => ({
  ...p,
  id: out(p.id),
  paths: p.paths.map(path),
  owners: p.owners.map(owner),
});

const relation = (r: row.ProjectRelation): dto.ProjectRelation => ({
  ...r,
  project: { ...r.project, id: out(r.project.id) },
});

const repo = (r: repos.ProjectRepo): dto.ProjectRepo => ({
  ...r,
  id: out(r.id),
  projectId: out(r.projectId),
});

const step = (s: row.Step): dto.Step => ({
  ...s,
  id: out(s.id),
  phaseId: outNull(s.phaseId),
  owner: s.owner ? owner(s.owner) : null,
});

const phase = (p: row.Phase): dto.Phase => ({ ...p, id: out(p.id), steps: p.steps.map(step) });

const summary = (t: row.TaskSummary): dto.TaskSummary => ({
  ...t,
  id: out(t.id),
  projects: t.projects.map((p) => ({ ...p, id: out(p.id) })),
  owners: t.owners.map(owner),
});

const task = (t: row.Task): dto.Task => ({
  ...summary(t),
  archivedAt: t.archivedAt,
  cancelledAt: t.cancelledAt,
  createdBy: t.createdBy,
  sourcePath: t.sourcePath,
  phases: t.phases.map(phase),
  looseSteps: t.looseSteps.map(step),
  links: t.links.map((l) => ({ ...l, task: { ...l.task, id: out(l.task.id) } })),
});

export class LocalTaskStore implements TaskStore {
  constructor(private readonly db: Sqlite = getDb()) {}

  async listProjects(options?: { includeArchived?: boolean }): Promise<dto.Project[]> {
    return projects.listProjects(this.db, options?.includeArchived).map(project);
  }

  async getProject(reference: Id | string): Promise<dto.Project | null> {
    const found = projects.getProject(this.db, ref(reference));
    return found ? project(found) : null;
  }

  async createProject(input: CreateProjectInput): Promise<dto.Project> {
    return project(projects.createProject(this.db, input));
  }

  async updateProject(
    projectId: Id,
    patch: { name?: string; summary?: string | null; archived?: boolean },
  ): Promise<dto.Project> {
    return project(projects.updateProject(this.db, id(projectId), patch));
  }

  async setProjectTheme(projectId: Id, theme: Partial<dto.ProjectTheme>): Promise<dto.Project> {
    return project(projects.setProjectTheme(this.db, id(projectId), theme));
  }

  async linkProjects(
    fromId: Id,
    toId: Id,
    kind: dto.ProjectRelation["kind"],
    note?: string | null,
  ): Promise<void> {
    projects.linkProjects(this.db, id(fromId), id(toId), kind, note);
  }

  async listProjectRelations(projectId: Id): Promise<dto.ProjectRelation[]> {
    return projects.listProjectRelations(this.db, id(projectId)).map(relation);
  }

  async suggestFreeHue(): Promise<number> {
    return projects.suggestFreeHue(this.db);
  }

  async listOwners(projectId: Id | null): Promise<dto.Owner[]> {
    return projects.listOwners(this.db, projectId === null ? null : id(projectId)).map(owner);
  }

  async upsertOwner(
    projectId: Id,
    input: { slug: string; label?: string; colorHue?: number | null },
  ): Promise<Id> {
    return out(projects.upsertOwner(this.db, id(projectId), input));
  }

  async listRepos(projectId: Id): Promise<dto.ProjectRepo[]> {
    return repos.listRepos(this.db, id(projectId)).map(repo);
  }

  async upsertRepo(projectId: Id, input: repos.RepoInput): Promise<Id> {
    return out(repos.upsertRepo(this.db, id(projectId), input));
  }

  async removeRepo(projectId: Id, key: string): Promise<boolean> {
    return repos.removeRepo(this.db, id(projectId), key);
  }

  async listTasks(filter: TaskFilter = {}): Promise<dto.TaskSummary[]> {
    return tasks
      .listTasks(this.db, {
        ...filter,
        projectId: filter.projectId === undefined ? undefined : id(filter.projectId),
      })
      .map(summary);
  }

  async getTask(reference: Id | string): Promise<dto.Task | null> {
    const found = tasks.getTask(this.db, ref(reference));
    return found ? task(found) : null;
  }

  async createTask(input: CreateTaskInput): Promise<dto.Task> {
    return task(
      tasks.createTask(this.db, {
        ...input,
        projectId: id(input.projectId),
        alsoProjectIds: input.alsoProjectIds?.map(id),
      }),
    );
  }

  async updateTask(taskId: Id, patch: UpdateTaskPatch): Promise<dto.Task> {
    return task(
      tasks.updateTask(this.db, id(taskId), {
        ...patch,
        alsoProjectIds: patch.alsoProjectIds?.map(id),
      }),
    );
  }

  async deleteTask(taskId: Id): Promise<void> {
    tasks.deleteTask(this.db, id(taskId));
  }

  async setTaskDone(taskId: Id, done: boolean, by: "user" | "agent"): Promise<dto.Task> {
    return task(tasks.setTaskDone(this.db, id(taskId), done, by));
  }

  async linkTasks(fromId: Id, toId: Id, kind: dto.TaskLink["kind"]): Promise<void> {
    tasks.linkTasks(this.db, id(fromId), id(toId), kind);
  }

  async addSteps(taskId: Id, steps: StepInput[], phaseName?: string | null): Promise<dto.Task> {
    return task(tasks.addSteps(this.db, id(taskId), steps, phaseName));
  }

  async updateStep(
    stepId: Id,
    patch: Partial<Omit<StepInput, "done" | "doneBy" | "phase">>,
  ): Promise<dto.Task> {
    tasks.updateStep(this.db, id(stepId), patch);
    return this.taskOfStep(stepId);
  }

  async setStepsDone(stepIds: Id[], done: boolean, by: "user" | "agent"): Promise<Id[]> {
    return tasks.setStepsDone(this.db, stepIds.map(id), done, by).map(out);
  }

  async deleteStep(stepId: Id): Promise<dto.Task> {
    const owning = this.taskOfStep(stepId);
    tasks.deleteStep(this.db, id(stepId));
    return task(tasks.getTask(this.db, Number(owning.id))!);
  }

  private taskOfStep(stepId: Id): dto.Task {
    const taskId = tasks.taskIdOfStep(this.db, id(stepId));
    if (taskId === null) throw new Error(`No step ${stepId}.`);
    return task(tasks.getTask(this.db, taskId)!);
  }

  async getLocale(): Promise<Locale> {
    return settings.getLocale(this.db);
  }

  async setLocale(locale: Locale): Promise<void> {
    settings.setLocale(this.db, locale);
  }
}
