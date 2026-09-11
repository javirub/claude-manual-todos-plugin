import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { LATEST_VERSION, connect, migrate } from "@/lib/db";
import {
  HueTooCloseError,
  addProjectPath,
  createProject,
  listProjects,
  getProject,
  removeProjectPath,
  resolveProjectsByPath,
  resolveProjectByPath,
  setProjectTheme,
} from "@/lib/db/projects";
import { addSteps, createTask, getTask, listTasks, setStepsDone, setTaskDone } from "@/lib/db/tasks";
import type { Sqlite } from "@/lib/db/driver";

function freshDb(): Sqlite {
  return connect(":memory:");
}

/**
 * Fixture paths are relative, and that is the point. Neither `addProjectPath` nor
 * `resolveProjectByPath` touches the filesystem — they resolve both sides against
 * the same `process.cwd()` and compare strings — so relative fixtures stay
 * consistent wherever the suite runs from, and they exercise that normalisation
 * instead of stepping around it with absolute literals.
 */
function seedCostia(db: Sqlite) {
  return createProject(db, {
    name: "Costia",
    summary: "Five repos, one product.",
    theme: { hue: 295, chroma: 0.16, mode: "dark", motif: "glow" },
    paths: [
      { path: "fixtures/costia", role: "superproject" },
      { path: "fixtures/costia/frontend", role: "frontend" },
      { path: "fixtures/costia/backend", role: "backend" },
    ],
    owners: [{ slug: "apple", label: "Apple" }],
  });
}

describe("migrations", () => {
  test("apply once and settle at the latest version", () => {
    const db = freshDb();
    expect(db.prepare("PRAGMA user_version").get<{ user_version: number }>()?.user_version).toBe(
      LATEST_VERSION,
    );
  });

  test("re-running against an up-to-date database changes nothing", () => {
    const db = freshDb();
    const before = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get<{ n: number }>()?.n;
    migrate(db);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get<{ n: number }>()?.n).toBe(before);
    expect(db.prepare("PRAGMA user_version").get<{ user_version: number }>()?.user_version).toBe(
      LATEST_VERSION,
    );
  });
});

describe("resolving a cwd to a project", () => {
  test("the longest matching path prefix wins", () => {
    const db = freshDb();
    const costia = seedCostia(db);
    const training = createProject(db, {
      name: "Costia training",
      theme: { hue: 150 },
      paths: [{ path: "fixtures/costia-training" }],
    });

    // A directory deep inside a repo resolves to the repo's project.
    const deep = resolveProjectByPath(db, "fixtures/costia/backend/src/main");
    expect(deep?.project.id).toBe(costia.id);
    expect(deep?.path.role).toBe("backend");

    // The superproject path still answers for directories no repo claims.
    expect(resolveProjectByPath(db, "fixtures/costia/docs")?.path.role).toBe("superproject");

    // A sibling whose name merely starts the same must not be swallowed.
    expect(resolveProjectByPath(db, "fixtures/costia-training")?.project.id).toBe(training.id);

    expect(resolveProjectByPath(db, "fixtures/somewhere-else")).toBeNull();
  });

  /*
   * The superproject case, which cost a whole session: only `<repo>/frontend` was
   * attached, a session opened at the repo root resolved to nothing, and the hook
   * that would have named the board stayed silent.
   */
  test("resolve a directory that sits above a registered path", () => {
    const db = freshDb();
    const costia = createProject(db, {
      name: "Costia",
      theme: { hue: 295 },
      paths: [{ path: "fixtures/costia/frontend", role: "frontend" }],
    });

    const above = resolveProjectByPath(db, "fixtures/costia");
    expect(above?.project.id).toBe(costia.id);
    // Flagged, because it is an inference: the directory is still not attached.
    expect(above?.viaDescendant).toBe(true);
    // Compared through `resolve`, never by a literal separator: on Windows the
    // stored path comes back with backslashes and a "/"-spelled tail never matches.
    expect(above?.path.path).toBe(resolve("fixtures/costia/frontend"));

    // Attaching it makes the answer direct, and the flag goes away.
    addProjectPath(db, costia.id, { path: "fixtures/costia", role: "superproject" });
    const attached = resolveProjectByPath(db, "fixtures/costia");
    expect(attached?.viaDescendant).toBeUndefined();
    expect(attached?.path.role).toBe("superproject");
  });

  /*
   * Shared infrastructure: one k3s-cluster repository behind three products. The
   * path used to be UNIQUE, so attaching it to a second project moved it and the
   * board you were shown depended on who registered it last.
   */
  test("a repository can belong to several projects at once", () => {
    const db = freshDb();
    const costia = createProject(db, { name: "Costia", theme: { hue: 295 }, paths: [] });
    const aura = createProject(db, { name: "Aura", theme: { hue: 80 }, paths: [] });

    addProjectPath(db, costia.id, { path: "fixtures/k3s-cluster", role: "clúster" });
    addProjectPath(db, aura.id, { path: "fixtures/k3s-cluster", role: "clúster" });

    // Attaching it to the second did not take it from the first.
    const both = resolveProjectsByPath(db, "fixtures/k3s-cluster");
    expect(both.map((r) => r.project.id).sort()).toEqual([costia.id, aura.id].sort());
    expect(getProject(db, costia.id)?.paths.some((p) => p.path === resolve("fixtures/k3s-cluster"))).toBe(
      true,
    );

    // Removing it from one leaves the other's.
    removeProjectPath(db, aura.id, "fixtures/k3s-cluster");
    expect(resolveProjectsByPath(db, "fixtures/k3s-cluster").map((r) => r.project.id)).toEqual([costia.id]);
  });

  test("the most specific project still answers when only one owns the path", () => {
    const db = freshDb();
    const costia = seedCostia(db);
    expect(resolveProjectsByPath(db, "fixtures/costia/backend/src")).toHaveLength(1);
    expect(resolveProjectByPath(db, "fixtures/costia/backend/src")?.project.id).toBe(costia.id);
  });

  test("refuse to guess when the descendants belong to different projects", () => {
    const db = freshDb();
    createProject(db, { name: "Costia", theme: { hue: 295 }, paths: [{ path: "fixtures/costia" }] });
    createProject(db, { name: "Aura", theme: { hue: 80 }, paths: [{ path: "fixtures/aura-map" }] });

    // `fixtures` holds both, so naming one of them would be arbitrary.
    expect(resolveProjectByPath(db, "fixtures")).toBeNull();
  });

  test("a relative path is stored resolved, and answers to its absolute form", () => {
    const db = freshDb();
    const costia = seedCostia(db);

    // This is the contract the MCP depends on: whatever form a path is registered
    // in, a cwd arrives absolute and still has to match.
    const absolute = resolve("fixtures/costia/backend");
    expect(resolveProjectByPath(db, absolute)?.project.id).toBe(costia.id);
    expect(resolveProjectByPath(db, `${absolute}/src/main`)?.path.role).toBe("backend");

    // And an absolute path that shares no prefix belongs to nobody, however
    // plausible it looks.
    expect(resolveProjectByPath(db, "/fixtures/costia/backend")).toBeNull();
  });
});

describe("project themes", () => {
  test("a hue too close to an existing project is refused, with a suggestion", () => {
    const db = freshDb();
    seedCostia(db);
    let error: unknown;
    try {
      createProject(db, { name: "Almost Costia", theme: { hue: 305 } });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HueTooCloseError);
    const hueError = error as HueTooCloseError;
    expect(hueError.suggestion).toBeGreaterThanOrEqual(0);
    expect(hueError.suggestion).toBeLessThan(360);
    // The refusal must not have left a half-made project behind.
    expect(listProjects(db).length).toBe(1);
  });

  test("a project keeps its own hue when its theme is edited", () => {
    const db = freshDb();
    const costia = seedCostia(db);
    const updated = setProjectTheme(db, costia.id, { hue: 295, motif: "grid" });
    expect(updated.theme.motif).toBe("grid");
    expect(updated.theme.hue).toBe(295);
  });

  test("a fresh project with no hue asked for gets a free one", () => {
    const db = freshDb();
    seedCostia(db);
    const other = createProject(db, { name: "Aura map" });
    expect(Math.abs(other.theme.hue - 295)).toBeGreaterThanOrEqual(25);
  });
});

describe("task state is derived from its steps", () => {
  test("a task is done exactly when every step is", () => {
    const db = freshDb();
    const costia = seedCostia(db);
    const task = createTask(db, {
      projectId: costia.id,
      title: "Unblock the App Review rejection",
      phases: [
        {
          name: "The listing",
          steps: [
            { title: "Change the Support URL", owner: "apple", value: "https://costia.app/support" },
            { title: "Paste the EULA", owner: "apple" },
          ],
        },
        { name: "The build", steps: [{ title: "Build iOS", owner: "eas" }] },
      ],
    });

    expect(task.state).toBe("open");
    expect(task.totalSteps).toBe(3);
    expect(task.phases.map((p) => p.name)).toEqual(["The listing", "The build"]);

    const allSteps = task.phases.flatMap((p) => p.steps);
    setStepsDone(db, allSteps.slice(0, 2).map((s) => s.id), true, "user");
    expect(getTask(db, task.id)!.state).toBe("open");

    setStepsDone(db, [allSteps[2].id], true, "agent");
    const done = getTask(db, task.id)!;
    expect(done.state).toBe("done");
    expect(done.completedAt).not.toBeNull();

    // Reopening one step takes the whole task back to open.
    setStepsDone(db, [allSteps[0].id], false, "user");
    expect(getTask(db, task.id)!.state).toBe("open");
  });

  test("adding a step to a finished task reopens it", () => {
    const db = freshDb();
    const costia = seedCostia(db);
    const task = createTask(db, {
      projectId: costia.id,
      title: "Seed secrets",
      steps: [{ title: "Create the secret", done: true, doneBy: "agent" }],
    });
    expect(task.state).toBe("done");
    const reopened = addSteps(db, task.id, [{ title: "Rotate the old key" }]);
    expect(reopened.state).toBe("open");
  });

  test("a task with no steps is done only when marked", () => {
    const db = freshDb();
    const costia = seedCostia(db);
    const task = createTask(db, { projectId: costia.id, title: "Reply to the reviewer" });
    expect(task.state).toBe("open");
    expect(setTaskDone(db, task.id, true, "user").state).toBe("done");
  });

  test("who closed a step is remembered", () => {
    const db = freshDb();
    const costia = seedCostia(db);
    const task = createTask(db, {
      projectId: costia.id,
      title: "Remove the promo codes",
      steps: [
        { title: "Delete the endpoint", done: true, doneBy: "agent", why: "Apple rejects the mechanism, not the screen." },
        { title: "Reply in Resolution Center" },
      ],
    });
    expect(task.looseSteps[0].doneBy).toBe("agent");
    expect(task.looseSteps[0].why).toContain("Apple");
    expect(task.looseSteps[1].doneAt).toBeNull();
  });
});

describe("ordering", () => {
  test("dated tasks come first by deadline, undated after by recency", () => {
    const db = freshDb();
    const costia = seedCostia(db);
    createTask(db, { projectId: costia.id, title: "Undated, the old one" });
    createTask(db, { projectId: costia.id, title: "Due late", dueAt: "2030-01-01" });
    createTask(db, { projectId: costia.id, title: "Due soon", dueAt: "2026-01-01" });
    createTask(db, { projectId: costia.id, title: "Undated, the new one" });

    expect(listTasks(db, { projectId: costia.id }).map((t) => t.title)).toEqual([
      "Due soon",
      "Due late",
      "Undated, the new one",
      "Undated, the old one",
    ]);
  });
});

describe("tasks across projects", () => {
  test("a transversal task shows up in every project it belongs to, with one state", () => {
    const db = freshDb();
    const costia = seedCostia(db);
    const cluster = createProject(db, { name: "k3s cluster", theme: { hue: 40 } });

    const task = createTask(db, {
      projectId: costia.id,
      alsoProjectIds: [cluster.id],
      title: "Promote the backend before the app",
      steps: [{ title: "Run promote_costia", owner: "gitlab" }],
    });

    expect(listTasks(db, { projectId: costia.id }).map((t) => t.id)).toContain(task.id);
    expect(listTasks(db, { projectId: cluster.id }).map((t) => t.id)).toContain(task.id);
    expect(task.projects.filter((p) => p.isPrimary).map((p) => p.slug)).toEqual([costia.slug]);

    setStepsDone(db, [task.looseSteps[0].id], true, "user");
    expect(listTasks(db, { projectId: cluster.id, state: "done" }).map((t) => t.id)).toContain(task.id);
    expect(listTasks(db, { projectId: costia.id, state: "open" })).toEqual([]);
  });
});

describe("filters", () => {
  test("owner, search and state narrow the list", () => {
    const db = freshDb();
    const costia = seedCostia(db);
    createTask(db, {
      projectId: costia.id,
      title: "Upload the build",
      steps: [{ title: "eas build", owner: "eas" }],
    });
    createTask(db, {
      projectId: costia.id,
      title: "Change the Support URL",
      steps: [{ title: "Edit the listing", owner: "apple" }],
    });

    expect(listTasks(db, { projectId: costia.id, ownerSlug: "apple" }).map((t) => t.title)).toEqual([
      "Change the Support URL",
    ]);
    expect(listTasks(db, { projectId: costia.id, query: "eas build" }).map((t) => t.title)).toEqual([
      "Upload the build",
    ]);
    // An owner nobody declared up front is created on demand, not rejected.
    expect(listTasks(db, { projectId: costia.id, ownerSlug: "eas" }).length).toBe(1);
  });
});
