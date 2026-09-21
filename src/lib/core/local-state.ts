/**
 * The facts about this computer, which never go anywhere.
 *
 * A checkout's absolute path, which machine this is, whether the status line
 * shows for a project: all true here and meaningless elsewhere. They stay in the
 * local SQLite file in both modes, so resolving a working directory keeps working
 * with no network and answers in microseconds — which it has to, because the
 * status line asks on every render.
 */
import type { Sqlite } from "@/lib/db/driver";
import { getDb } from "@/lib/db";
import { boardPort } from "@/lib/db/paths";
import { addProjectPath, listPaths, removeProjectPath, resolveProjectsByPath } from "@/lib/db/projects";
import { getProjectBase, setProjectBase } from "@/lib/db/repos";
import {
  getStatuslineDefault,
  getStatuslineOverride,
  setStatuslineDefault,
  setStatuslineOverride,
  statuslineEnabledFor,
} from "@/lib/db/settings";
import { machineId, machineLabel, registerMachine } from "@/lib/machine";

import type { Id, ProjectPath } from "./types";

/** A project resolved from a directory. Only the slug travels; the rest is local. */
export interface ResolvedHere {
  projectSlug: string;
  projectId: Id;
  path: ProjectPath;
  viaDescendant: boolean;
}

export class LocalState {
  constructor(private readonly db: Sqlite = getDb()) {}

  machineId(): string {
    return machineId();
  }

  machineLabel(): string {
    return machineLabel();
  }

  register(): string {
    return registerMachine(this.db);
  }

  boardPort(): number {
    return boardPort();
  }

  /**
   * Every project a directory belongs to, most specific first.
   *
   * Plural because a repository can serve several products, and answering "the"
   * project of a path is the question that cannot always be answered.
   */
  resolve(cwd: string): ResolvedHere[] {
    return resolveProjectsByPath(this.db, cwd).map((r) => ({
      projectSlug: r.project.slug,
      projectId: String(r.project.id),
      path: {
        ...r.path,
        id: String(r.path.id),
        repoId: r.path.repoId === null ? null : String(r.path.repoId),
      },
      viaDescendant: r.viaDescendant ?? false,
    }));
  }

  listPaths(projectId: Id): ProjectPath[] {
    return listPaths(this.db, Number(projectId)).map((p) => ({
      ...p,
      id: String(p.id),
      repoId: p.repoId === null ? null : String(p.repoId),
    }));
  }

  addPath(
    projectId: Id,
    input: { path: string; label?: string | null; role?: string | null; repoId?: Id | null },
  ): void {
    addProjectPath(this.db, Number(projectId), {
      ...input,
      repoId: input.repoId ? Number(input.repoId) : null,
      machineId: this.machineId(),
    });
  }

  removePath(projectId: Id, path: string): boolean {
    return removeProjectPath(this.db, Number(projectId), path);
  }

  projectBase(projectId: Id): string | null {
    return getProjectBase(this.db, Number(projectId), this.machineId());
  }

  setProjectBase(projectId: Id, base: string): string {
    return setProjectBase(this.db, Number(projectId), this.machineId(), base);
  }

  /* The status line is about this terminal, so it is never a cloud setting. */
  statuslineEnabledFor(slug: string): boolean {
    return statuslineEnabledFor(this.db, slug);
  }

  statuslineDefault(): boolean {
    return getStatuslineDefault(this.db);
  }

  setStatuslineDefault(enabled: boolean): void {
    setStatuslineDefault(this.db, enabled);
  }

  statuslineOverride(slug: string): boolean | null {
    return getStatuslineOverride(this.db, slug);
  }

  setStatuslineOverride(slug: string, enabled: boolean | null): void {
    setStatuslineOverride(this.db, slug, enabled);
  }
}
