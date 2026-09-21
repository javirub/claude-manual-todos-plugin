/**
 * The port over the hosted service.
 *
 * A thin translation and nothing else: no caching, no retries beyond the one a
 * refreshed token deserves, no cleverness about which call to make. Everything
 * that decides who may see what happens on the other side of this, and a client
 * that started making those decisions locally would be deciding its own
 * permissions.
 *
 * The routes and shapes here are the contract in
 * packages/backend/openapi.json; the DTOs it returns are the same shapes
 * ./types declares, which is what lets this be a drop-in for the local store.
 */
import { NotPermittedError } from "./port";
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

export interface RemoteConfig {
  api: string;
  workspace: string;
  token: string;
  /** Called with a fresh token when the old one expires mid-call. */
  refresh?: () => Promise<string | null>;
}

interface Problem {
  title?: string;
  detail?: string;
  capability_required?: string;
  capability_held?: string;
}

export class HttpTaskStore implements TaskStore {
  private token: string;

  constructor(private readonly config: RemoteConfig) {
    this.token = config.token;
  }

  private url(path: string, query?: Record<string, string | undefined>): string {
    const base = this.config.api.replace(/\/+$/, "");
    const url = new URL(`${base}/v1/workspaces/${encodeURIComponent(this.config.workspace)}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async send<T>(url: string, init: RequestInit = {}, retried = false): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
        ...(init.headers ?? {}),
      },
    });

    // One retry, and only for an expired token. Anything else that fails twice
    // would fail a third time, and a client that keeps trying is how a model's
    // retry loop turns into a denial of service against its own backend.
    if (response.status === 401 && !retried && this.config.refresh) {
      const fresh = await this.config.refresh();
      if (fresh) {
        this.token = fresh;
        return this.send<T>(url, init, true);
      }
    }

    if (!response.ok) throw await problem(response);
    if (response.status === 204) return undefined as T;

    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private get<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    return this.send<T>(this.url(path, query));
  }

  private write<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.send<T>(this.url(path), {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /* -------------------------------------------------------------- projects */

  listProjects(options?: { includeArchived?: boolean }): Promise<dto.Project[]> {
    return this.get("/projects", { includeArchived: options?.includeArchived ? "true" : undefined });
  }

  async getProject(ref: Id | string): Promise<dto.Project | null> {
    try {
      return await this.get<dto.Project>(`/projects/${encodeURIComponent(ref)}`);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  createProject(input: CreateProjectInput): Promise<dto.Project> {
    return this.write("POST", "/projects", input);
  }

  updateProject(
    id: Id,
    patch: { name?: string; summary?: string | null; archived?: boolean },
  ): Promise<dto.Project> {
    return this.write("PATCH", `/projects/${encodeURIComponent(id)}`, patch);
  }

  setProjectTheme(id: Id, theme: Partial<dto.ProjectTheme>): Promise<dto.Project> {
    return this.write("PATCH", `/projects/${encodeURIComponent(id)}`, { theme });
  }

  async linkProjects(
    fromId: Id,
    toId: Id,
    kind: dto.ProjectRelation["kind"],
    note?: string | null,
  ): Promise<void> {
    await this.write("POST", `/projects/${encodeURIComponent(fromId)}/links`, { toProjectId: toId, kind, note });
  }

  listProjectRelations(id: Id): Promise<dto.ProjectRelation[]> {
    return this.get(`/projects/${encodeURIComponent(id)}/links`);
  }

  suggestFreeHue(): Promise<number> {
    return this.get("/hue-suggestion");
  }

  listOwners(projectId: Id | null): Promise<dto.Owner[]> {
    if (projectId === null) return Promise.resolve([]);
    return this.get(`/projects/${encodeURIComponent(projectId)}/owners`);
  }

  async upsertOwner(
    projectId: Id,
    input: { slug: string; label?: string; colorHue?: number | null },
  ): Promise<Id> {
    const owner = await this.write<dto.Owner>("POST", `/projects/${encodeURIComponent(projectId)}/owners`, input);
    return owner.id;
  }

  /* ------------------------------------------------------------------ repos */

  async listRepos(projectId: Id): Promise<dto.ProjectRepo[]> {
    const answer = await this.get<{ repos: dto.ProjectRepo[]; withheld: number }>(
      `/projects/${encodeURIComponent(projectId)}/repos`,
    );
    // `withheld` is deliberately dropped here rather than surfaced as a fake
    // repository: a caller that wants the count asks withheldRepos().
    return answer.repos;
  }

  /** How many repositories exist that this account may not be told about. */
  async withheldRepos(projectId: Id): Promise<number> {
    const answer = await this.get<{ withheld: number }>(`/projects/${encodeURIComponent(projectId)}/repos`);
    return answer.withheld;
  }

  async upsertRepo(projectId: Id, input: Parameters<TaskStore["upsertRepo"]>[1]): Promise<Id> {
    const answer = await this.write<{ repos: dto.ProjectRepo[] }>(
      "POST", `/projects/${encodeURIComponent(projectId)}/repos`, input);
    return answer.repos.find((r) => r.key === input.key)?.id ?? "";
  }

  removeRepo(projectId: Id, key: string): Promise<boolean> {
    return this.write("DELETE", `/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(key)}`);
  }

  /* ------------------------------------------------------------------ tasks */

  listTasks(filter: TaskFilter = {}): Promise<dto.TaskSummary[]> {
    return this.get("/tasks", {
      project: filter.projectId,
      state: filter.state,
      owner: filter.ownerSlug,
      q: filter.query,
    });
  }

  async getTask(ref: Id | string): Promise<dto.Task | null> {
    try {
      return await this.get<dto.Task>(`/tasks/${encodeURIComponent(ref)}`);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  createTask(input: CreateTaskInput): Promise<dto.Task> {
    return this.write("POST", "/tasks", input);
  }

  updateTask(id: Id, patch: UpdateTaskPatch): Promise<dto.Task> {
    return this.write("PATCH", `/tasks/${encodeURIComponent(id)}`, patch);
  }

  async deleteTask(id: Id): Promise<void> {
    await this.write("DELETE", `/tasks/${encodeURIComponent(id)}`);
  }

  setTaskDone(id: Id, done: boolean): Promise<dto.Task> {
    return this.write("POST", `/tasks/${encodeURIComponent(id)}/done`, { done });
  }

  async linkTasks(fromId: Id, toId: Id, kind: dto.TaskLink["kind"]): Promise<void> {
    await this.write("POST", `/tasks/${encodeURIComponent(fromId)}/links`, { toTaskId: toId, kind });
  }

  /* ------------------------------------------------------------------ steps */

  addSteps(taskId: Id, steps: StepInput[], phaseName?: string | null): Promise<dto.Task> {
    return this.write("POST", `/tasks/${encodeURIComponent(taskId)}/steps`, { phase: phaseName, steps });
  }

  async updateStep(
    stepId: Id,
    patch: Partial<Omit<StepInput, "done" | "doneBy" | "phase">>,
  ): Promise<dto.Task> {
    return this.write("PATCH", `/steps/${encodeURIComponent(stepId)}`, patch);
  }

  async setStepsDone(stepIds: Id[], done: boolean): Promise<Id[]> {
    const tasks = await this.write<dto.Task[]>("POST", "/steps/done", { stepIds, done });
    return tasks.map((task) => task.id);
  }

  deleteStep(stepId: Id): Promise<dto.Task> {
    return this.write("DELETE", `/steps/${encodeURIComponent(stepId)}`);
  }

  /* ------------------------------------------------------------ preferences */

  async getLocale(): Promise<Locale> {
    const base = this.config.api.replace(/\/+$/, "");
    const preferences = await this.send<{ locale: Locale }>(`${base}/v1/me/preferences`);
    return preferences.locale;
  }

  async setLocale(locale: Locale): Promise<void> {
    const base = this.config.api.replace(/\/+$/, "");
    await this.send(`${base}/v1/me/preferences`, { method: "PUT", body: JSON.stringify({ locale }) });
  }
}

/** Turns a problem document into the error the rest of the code already handles. */
async function problem(response: Response): Promise<Error> {
  let body: Problem = {};
  try {
    body = (await response.json()) as Problem;
  } catch {
    /* Not every failure is well-mannered enough to be JSON. */
  }
  const message = body.detail || body.title || `${response.status} ${response.statusText}`;

  if (response.status === 403) {
    return new NotPermittedError(message, body.capability_required, body.capability_held);
  }
  const error = new Error(message) as Error & { status?: number };
  error.status = response.status;
  return error;
}

function isMissing(error: unknown): boolean {
  return (error as { status?: number })?.status === 404;
}

export function createRemoteStore(config: RemoteConfig): TaskStore {
  return new HttpTaskStore(config);
}
