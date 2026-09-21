/**
 * The conformance suite for TaskStore.
 *
 * Written against the interface and nothing else, so the same file proves the
 * local implementation today and the HTTP one later. Anything in here that needs
 * to know it is talking to SQLite is a bug in the seam, not in the test.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { connect } from "@/lib/db";
import { LocalTaskStore } from "@/lib/core/local";
import type { TaskStore } from "@/lib/core/port";

function freshStore(): TaskStore {
  return new LocalTaskStore(connect(":memory:"));
}

describe("TaskStore conformance", () => {
  let store: TaskStore;
  beforeEach(() => {
    store = freshStore();
  });

  test("ids are opaque strings, and they come back as they went out", async () => {
    const project = await store.createProject({ name: "Costia" });
    expect(typeof project.id).toBe("string");

    const task = await store.createTask({ title: "Ship it", projectId: project.id });
    expect(typeof task.id).toBe("string");
    expect(task.projects[0]!.id).toBe(project.id);

    // Round trip: an id handed to us is accepted back without translation.
    expect((await store.getTask(task.id))?.id).toBe(task.id);
    expect((await store.getProject(project.id))?.id).toBe(project.id);
  });

  test("a project is found by slug as well as by id", async () => {
    const project = await store.createProject({ name: "Costia Training" });
    expect((await store.getProject("costia-training"))?.id).toBe(project.id);
    expect(await store.getProject("nothing-like-this")).toBe(null);
  });

  test("a task's state is derived from its steps, never set", async () => {
    const project = await store.createProject({ name: "Costia" });
    const task = await store.createTask({
      title: "Release",
      projectId: project.id,
      steps: [{ title: "Upload build" }, { title: "Answer review" }],
    });
    expect(task.state).toBe("open");

    const stepIds = task.looseSteps.map((s) => s.id);
    await store.setStepsDone([stepIds[0]!], true, "user");
    expect((await store.getTask(task.id))?.state).toBe("open");

    await store.setStepsDone([stepIds[1]!], true, "agent");
    const done = await store.getTask(task.id);
    expect(done?.state).toBe("done");
    expect(done?.doneSteps).toBe(2);

    // Reopening one reopens the task: there is no field that can disagree.
    await store.setStepsDone([stepIds[0]!], false, "user");
    expect((await store.getTask(task.id))?.state).toBe("open");
  });

  test("who closed a step is remembered", async () => {
    const project = await store.createProject({ name: "Costia" });
    const task = await store.createTask({
      title: "Release",
      projectId: project.id,
      steps: [{ title: "Upload build" }],
    });
    await store.setStepsDone([task.looseSteps[0]!.id], true, "agent");
    expect((await store.getTask(task.id))?.looseSteps[0]!.doneBy).toBe("agent");
  });

  test("a task can belong to several projects with one shared state", async () => {
    const a = await store.createProject({ name: "Costia" });
    const b = await store.createProject({ name: "SINA" });
    const task = await store.createTask({
      title: "Rotate the secret",
      projectId: a.id,
      alsoProjectIds: [b.id],
    });

    expect(task.projects.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    expect(task.projects.filter((p) => p.isPrimary).length).toBe(1);

    // The same task, from either side.
    expect((await store.listTasks({ projectId: b.id })).map((t) => t.id)).toContain(task.id);
    await store.setTaskDone(task.id, true, "user");
    expect((await store.listTasks({ projectId: a.id, state: "done" })).length).toBe(1);
  });

  test("filters narrow without losing each other", async () => {
    const project = await store.createProject({ name: "Costia", owners: [{ slug: "appstore" }] });
    await store.createTask({
      title: "Upload the build",
      projectId: project.id,
      steps: [{ title: "Upload", owner: "appstore" }],
    });
    await store.createTask({ title: "Something else", projectId: project.id });

    expect((await store.listTasks({ projectId: project.id })).length).toBe(2);
    expect((await store.listTasks({ projectId: project.id, ownerSlug: "appstore" })).length).toBe(1);
    expect((await store.listTasks({ projectId: project.id, query: "build" })).length).toBe(1);
  });

  test("phases keep their steps, and loose steps stay loose", async () => {
    const project = await store.createProject({ name: "Costia" });
    const task = await store.createTask({
      title: "Release",
      projectId: project.id,
      phases: [{ name: "Before", steps: [{ title: "Tag it" }] }],
      steps: [{ title: "Tell the team" }],
    });
    expect(task.phases.length).toBe(1);
    expect(task.phases[0]!.steps.map((s) => s.title)).toEqual(["Tag it"]);
    expect(task.looseSteps.map((s) => s.title)).toEqual(["Tell the team"]);
  });

  test("steps can be added, edited and removed", async () => {
    const project = await store.createProject({ name: "Costia" });
    let task = await store.createTask({ title: "Release", projectId: project.id });
    task = await store.addSteps(task.id, [{ title: "First" }, { title: "Second" }]);
    expect(task.looseSteps.length).toBe(2);

    await store.updateStep(task.looseSteps[0]!.id, { title: "First, renamed", value: "abc" });
    await store.deleteStep(task.looseSteps[1]!.id);

    const after = await store.getTask(task.id);
    expect(after?.looseSteps.map((s) => s.title)).toEqual(["First, renamed"]);
    expect(after?.looseSteps[0]!.value).toBe("abc");
  });

  test("links go both ways and are visible from both ends", async () => {
    const project = await store.createProject({ name: "Costia" });
    const first = await store.createTask({ title: "Blocks", projectId: project.id });
    const second = await store.createTask({ title: "Blocked", projectId: project.id });
    await store.linkTasks(first.id, second.id, "blocks");

    expect((await store.getTask(first.id))?.links).toEqual([
      expect.objectContaining({ kind: "blocks", direction: "outgoing" }),
    ]);
    expect((await store.getTask(second.id))?.links).toEqual([
      expect.objectContaining({ kind: "blocks", direction: "incoming" }),
    ]);
  });

  test("projects carry an identity, and two of them cannot look alike", async () => {
    const first = await store.createProject({ name: "Costia", theme: { hue: 200 } });
    expect(first.theme.hue).toBe(200);
    // Within 25° of an existing hue is refused; that rule is the point of themes.
    await expect(store.createProject({ name: "Near", theme: { hue: 210 } })).rejects.toThrow();

    const free = await store.suggestFreeHue();
    expect(free).toBeGreaterThanOrEqual(0);
    expect(free).toBeLessThan(360);
  });

  test("repositories are recorded per project and merge rather than overwrite", async () => {
    const project = await store.createProject({ name: "Costia" });
    await store.upsertRepo(project.id, { key: "frontend", remoteUrl: "https://example.com/f" });
    await store.upsertRepo(project.id, { key: "frontend", relativePath: "frontend" });

    const [repo] = await store.listRepos(project.id);
    expect(repo?.remoteUrl).toBe("https://example.com/f");
    expect(repo?.relativePath).toBe("frontend");

    expect(await store.removeRepo(project.id, "frontend")).toBe(true);
    expect(await store.removeRepo(project.id, "frontend")).toBe(false);
  });

  test("archiving hides a project from the default listing", async () => {
    const project = await store.createProject({ name: "Costia" });
    await store.updateProject(project.id, { archived: true });
    expect((await store.listProjects()).length).toBe(0);
    expect((await store.listProjects({ includeArchived: true })).length).toBe(1);
  });

  test("deleting a task takes its steps with it", async () => {
    const project = await store.createProject({ name: "Costia" });
    const task = await store.createTask({
      title: "Gone",
      projectId: project.id,
      steps: [{ title: "Also gone" }],
    });
    await store.deleteTask(task.id);
    expect(await store.getTask(task.id)).toBe(null);
  });

  test("the locale is a preference the store owns", async () => {
    expect(["en", "es"]).toContain(await store.getLocale());
    await store.setLocale("es");
    expect(await store.getLocale()).toBe("es");
  });

  test("an id from nowhere is refused rather than silently doing nothing", async () => {
    await expect(store.deleteTask("not-an-id")).rejects.toThrow();
  });
});
