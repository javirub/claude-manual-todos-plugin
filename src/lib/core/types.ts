/**
 * What everything above the database talks about.
 *
 * These are the same shapes as `@/lib/db/types`, with one difference that is the
 * whole point: an id is an opaque string. SQLite hands out row numbers and a
 * server hands out something else, and nothing between the store and the screen
 * should have an opinion about which. `@/lib/db/types` stays row-shaped and stays
 * private to `@/lib/db`.
 */
export type Id = string;

export type {
  ThemeMode,
  ThemeMotif,
  ThemeFont,
  ThemeRadius,
  ProjectTheme,
  ProjectCounts,
  TaskState,
} from "@/lib/db/types";

import type {
  ProjectCounts,
  ProjectTheme,
  TaskState,
} from "@/lib/db/types";

export interface ProjectPath {
  id: Id;
  path: string;
  label: string | null;
  role: string | null;
  repoId: Id | null;
  machineId: string | null;
  realPath: string | null;
}

export interface Owner {
  id: Id;
  slug: string;
  label: string;
  colorHue: number | null;
}

export interface Project {
  id: Id;
  slug: string;
  name: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  theme: ProjectTheme;
  paths: ProjectPath[];
  owners: Owner[];
  counts: ProjectCounts;
}

export interface ProjectRelation {
  project: Pick<Project, "id" | "slug" | "name">;
  kind: "relates" | "depends_on" | "shares_infra";
  note: string | null;
}

export interface Step {
  id: Id;
  phaseId: Id | null;
  position: number;
  title: string;
  bodyMd: string | null;
  why: string | null;
  value: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  owner: Owner | null;
  doneAt: string | null;
  doneBy: "user" | "agent" | null;
}

export interface Phase {
  id: Id;
  position: number;
  name: string;
  note: string | null;
  steps: Step[];
}

export interface TaskProjectRef {
  id: Id;
  slug: string;
  name: string;
  isPrimary: boolean;
  hue: number;
}

export interface TaskLink {
  kind: "blocks" | "relates";
  direction: "outgoing" | "incoming";
  task: { id: Id; slug: string; title: string; state: TaskState };
}

export interface TaskSummary {
  id: Id;
  slug: string;
  title: string;
  summary: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  state: TaskState;
  totalSteps: number;
  doneSteps: number;
  projects: TaskProjectRef[];
  owners: Owner[];
}

export interface Task extends TaskSummary {
  archivedAt: string | null;
  cancelledAt: string | null;
  createdBy: "agent" | "user";
  sourcePath: string | null;
  phases: Phase[];
  looseSteps: Step[];
  links: TaskLink[];
}

export interface ProjectRepo {
  id: Id;
  projectId: Id;
  key: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
  relativePath: string | null;
  label: string | null;
  role: string | null;
}
