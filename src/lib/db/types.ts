export type ThemeMode = "dark" | "light" | "auto";
export type ThemeMotif = "none" | "grid" | "dots" | "lines" | "glow" | "noise";
export type ThemeFont = "geometric" | "grotesque" | "serif" | "mono";
export type ThemeRadius = "sharp" | "soft" | "round";

export interface ProjectTheme {
  mode: ThemeMode;
  hue: number;
  chroma: number;
  neutralChroma: number;
  accent2Hue: number | null;
  motif: ThemeMotif;
  fontHeading: ThemeFont;
  radius: ThemeRadius;
}

export interface ProjectPath {
  id: number;
  path: string;
  label: string | null;
  role: string | null;
}

export interface Owner {
  id: number;
  slug: string;
  label: string;
  colorHue: number | null;
}

export interface ProjectCounts {
  open: number;
  done: number;
  overdue: number;
}

export interface Project {
  id: number;
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
  id: number;
  phaseId: number | null;
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
  id: number;
  position: number;
  name: string;
  note: string | null;
  steps: Step[];
}

export type TaskState = "open" | "done" | "archived" | "cancelled";

export interface TaskProjectRef {
  id: number;
  slug: string;
  name: string;
  isPrimary: boolean;
  hue: number;
}

export interface TaskLink {
  kind: "blocks" | "relates";
  direction: "outgoing" | "incoming";
  task: { id: number; slug: string; title: string; state: TaskState };
}

export interface TaskSummary {
  id: number;
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
