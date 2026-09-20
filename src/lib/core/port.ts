/**
 * The seam between what this plugin does and where the data is.
 *
 * Everything is async, including the local implementation, which reads a
 * synchronous SQLite file and has nothing to wait for. That is deliberate: the
 * other implementation talks to a server, and a seam that is synchronous on one
 * side is not a seam at all — it would have to be torn open again, at every call
 * site, the first time anything went over a network.
 *
 * What is *not* here is as considered as what is. Resolving a working directory,
 * registering a checkout and remembering whether the status line is on are facts
 * about this computer. They never travel, so they never go through this
 * interface; see ./local-state.
 */
import type {
  Id,
  Owner,
  Project,
  ProjectRelation,
  ProjectRepo,
  ProjectTheme,
  Task,
  TaskLink,
  TaskState,
  TaskSummary,
} from "./types";

export interface TaskFilter {
  projectId?: Id;
  state?: TaskState | "all";
  ownerSlug?: string;
  dueBefore?: string;
  query?: string;
}

export interface StepInput {
  title: string;
  body?: string | null;
  why?: string | null;
  value?: string | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
  owner?: string | null;
  done?: boolean;
  doneBy?: "user" | "agent";
  phase?: string | null;
}

export interface PhaseInput {
  name: string;
  note?: string | null;
  steps: StepInput[];
}

export interface CreateProjectInput {
  name: string;
  slug?: string;
  summary?: string | null;
  theme?: Partial<ProjectTheme>;
  paths?: Array<{ path: string; label?: string | null; role?: string | null }>;
  owners?: Array<{ slug: string; label?: string; colorHue?: number | null }>;
}

export interface CreateTaskInput {
  title: string;
  summary?: string | null;
  dueAt?: string | null;
  projectId: Id;
  alsoProjectIds?: Id[];
  phases?: PhaseInput[];
  steps?: StepInput[];
  createdBy?: "agent" | "user";
  sourcePath?: string | null;
  sourceSession?: string | null;
}

export interface UpdateTaskPatch {
  title?: string;
  summary?: string | null;
  dueAt?: string | null;
  archived?: boolean;
  cancelled?: boolean;
  alsoProjectIds?: Id[];
}

export type Locale = "en" | "es";

export interface TaskStore {
  /* projects */
  listProjects(options?: { includeArchived?: boolean }): Promise<Project[]>;
  getProject(ref: Id | string): Promise<Project | null>;
  createProject(input: CreateProjectInput): Promise<Project>;
  updateProject(
    id: Id,
    patch: { name?: string; summary?: string | null; archived?: boolean },
  ): Promise<Project>;
  setProjectTheme(id: Id, theme: Partial<ProjectTheme>): Promise<Project>;
  linkProjects(
    fromId: Id,
    toId: Id,
    kind: ProjectRelation["kind"],
    note?: string | null,
  ): Promise<void>;
  listProjectRelations(id: Id): Promise<ProjectRelation[]>;
  suggestFreeHue(): Promise<number>;
  listOwners(projectId: Id | null): Promise<Owner[]>;
  upsertOwner(
    projectId: Id,
    input: { slug: string; label?: string; colorHue?: number | null },
  ): Promise<Id>;

  /* repositories — portable, so they belong to the project rather than the machine */
  listRepos(projectId: Id): Promise<ProjectRepo[]>;
  upsertRepo(
    projectId: Id,
    input: {
      key: string;
      remoteUrl?: string | null;
      defaultBranch?: string | null;
      relativePath?: string | null;
      label?: string | null;
      role?: string | null;
    },
  ): Promise<Id>;
  removeRepo(projectId: Id, key: string): Promise<boolean>;

  /* tasks */
  listTasks(filter?: TaskFilter): Promise<TaskSummary[]>;
  getTask(ref: Id | string): Promise<Task | null>;
  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(id: Id, patch: UpdateTaskPatch): Promise<Task>;
  deleteTask(id: Id): Promise<void>;
  setTaskDone(id: Id, done: boolean, by: "user" | "agent"): Promise<Task>;
  linkTasks(fromId: Id, toId: Id, kind: TaskLink["kind"]): Promise<void>;

  /* steps */
  addSteps(taskId: Id, steps: StepInput[], phaseName?: string | null): Promise<Task>;
  /** Returns the task, because a step is never looked at on its own. */
  updateStep(stepId: Id, patch: Partial<Omit<StepInput, "done" | "doneBy" | "phase">>): Promise<Task>;
  setStepsDone(stepIds: Id[], done: boolean, by: "user" | "agent"): Promise<Id[]>;
  deleteStep(stepId: Id): Promise<Task>;

  /* preferences that belong to the person, not the computer */
  getLocale(): Promise<Locale>;
  setLocale(locale: Locale): Promise<void>;
}

/** Thrown by an implementation that cannot do something the caller asked for. */
export class NotPermittedError extends Error {
  constructor(message: string, readonly required?: string, readonly held?: string) {
    super(message);
    this.name = "NotPermittedError";
  }
}
