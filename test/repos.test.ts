import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { connect } from "@/lib/db";
import { LocalState } from "@/lib/core/local-state";
import { LocalTaskStore } from "@/lib/core/local";
import { addProjectPath, createProject, listPaths, resolveProjectByPath, resolveProjectsByPath } from "@/lib/db/projects";
import { commonAncestor, listRepos, relativeTo, setProjectBase, upsertRepo } from "@/lib/db/repos";
import { normaliseRemote, sameRemote, gitAvailable, detectRepo } from "@/lib/git";
import { applyScan, executeImport, planImport, scanProject } from "@/lib/import";
import { machineId, registerMachine, resetMachineCache } from "@/lib/machine";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    try { rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* %TEMP% */ }
  }
});

function tempDir(): string {
  // realpath.native, not realpath, and both halves of that matter.
  //
  // macOS hands out /var/folders and resolves it through /private, which is the
  // very confusion these tests are about. And Windows hands the same directory
  // out as C:\Users\RUNNER~1\... through one API and C:\Users\runneradmin\...
  // through another — git returns the long form, mkdtemp the short one, and a
  // plain string comparison between them fails on the runner and nowhere else.
  // `.native` is what collapses the two, which is why canonical() in db/paths
  // uses it too.
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "todos repos ")));
  temporary.push(directory);
  return directory;
}

const git = (args: string[], cwd?: string) =>
  spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

/** A bare repository with one commit, to clone from without touching a network. */
function originRepo(root: string, name: string): string {
  const work = join(root, `${name}-work`);
  const bare = join(root, `${name}.git`);
  mkdirSync(work, { recursive: true });
  git(["init", "-q", "-b", "main"], work);
  git(["config", "user.email", "t@example.com"], work);
  git(["config", "user.name", "Test"], work);
  writeFileSync(join(work, "README.md"), `# ${name}\n`);
  git(["add", "-A"], work);
  git(["commit", "-qm", "first"], work);
  git(["clone", "-q", "--bare", work, bare]);
  return bare;
}

describe("normaliseRemote", () => {
  test("ssh and https spellings of one repository agree", () => {
    expect(normaliseRemote("git@github.com:costia/frontend.git"))
      .toBe(normaliseRemote("https://github.com/costia/frontend"));
    expect(normaliseRemote("ssh://git@github.com/costia/frontend.git"))
      .toBe(normaliseRemote("https://github.com/costia/frontend/"));
    expect(sameRemote("git@gitlab.com:a/b.git", "https://gitlab.com/a/b")).toBe(true);
  });

  test("different repositories stay different", () => {
    expect(sameRemote("git@github.com:costia/frontend.git", "git@github.com:costia/backend.git")).toBe(false);
    // A prefix is not a match, the same way /repos/costia-training is not inside /repos/costia.
    expect(sameRemote("https://github.com/a/b", "https://github.com/a/bb")).toBe(false);
  });

  test("a missing remote never matches, including another missing one", () => {
    expect(sameRemote(null, null)).toBe(false);
    expect(sameRemote("https://github.com/a/b", null)).toBe(false);
  });
});

describe("layout", () => {
  test("the common ancestor of several checkouts is their base", () => {
    // join, never string concatenation: commonAncestor splits on the platform
    // separator, and "D:\\x" + "/Proyectos" is a path no Windows API agrees with.
    // Written with slashes first, it passed everywhere except the runner.
    const root = resolve("/x");
    expect(commonAncestor([join(root, "Proyectos/costia/frontend"), join(root, "Proyectos/costia/backend")]))
      .toBe(join(root, "Proyectos/costia"));
  });

  test("one checkout's base is its parent, not itself", () => {
    // Otherwise importing would place the repository inside a directory named
    // after it: ~/Proyectos/frontend/frontend.
    const root = resolve("/x");
    const base = commonAncestor([join(root, "Proyectos/costia/frontend")]);
    expect(base).toBe(join(root, "Proyectos/costia"));
  });

  test("relativeTo refuses a path that is not under the base", () => {
    const root = resolve("/x");
    expect(relativeTo(join(root, "Proyectos"), join(root, "Proyectos/costia/api"))).toBe("costia/api");
    expect(relativeTo(join(root, "Proyectos"), join(root, "Otros/costia"))).toBe(null);
    // A sibling whose name starts the same is not inside it.
    expect(relativeTo(join(root, "repos/costia"), join(root, "repos/costia-training"))).toBe(null);
  });
});

describe("symlinked checkouts", () => {
  const canSymlink = platform() !== "win32";

  test.skipIf(!canSymlink)("a path registered through a symlink resolves from the real directory", () => {
    const root = tempDir();
    const real = join(root, "real", "costia");
    mkdirSync(real, { recursive: true });
    const link = join(root, "link");
    symlinkSync(join(root, "real"), link);

    const db = connect(":memory:");
    const project = createProject(db, { name: "Costia" });
    // Registered the way the user typed it: through the symlink.
    addProjectPath(db, project.id, { path: join(link, "costia") });

    // Standing in the directory git and the shell would report.
    const resolved = resolveProjectByPath(db, real);
    expect(resolved?.project.slug).toBe(project.slug);
    db.close();
  });

  test.skipIf(!canSymlink)("and the other way round: registered real, entered through the link", () => {
    const root = tempDir();
    const real = join(root, "real", "costia");
    mkdirSync(real, { recursive: true });
    symlinkSync(join(root, "real"), join(root, "link"));

    const db = connect(":memory:");
    const project = createProject(db, { name: "Costia" });
    addProjectPath(db, project.id, { path: real });

    expect(resolveProjectByPath(db, join(root, "link", "costia"))?.project.slug).toBe(project.slug);
    db.close();
  });

  test.skipIf(!canSymlink)("a sibling reached through a symlink is still not inside", () => {
    const root = tempDir();
    mkdirSync(join(root, "real", "costia"), { recursive: true });
    mkdirSync(join(root, "real", "costia-training"), { recursive: true });
    symlinkSync(join(root, "real"), join(root, "link"));

    const db = connect(":memory:");
    const project = createProject(db, { name: "Costia" });
    addProjectPath(db, project.id, { path: join(root, "real", "costia") });

    expect(resolveProjectByPath(db, join(root, "link", "costia-training"))).toBe(null);
    db.close();
  });

  test("a path that does not exist is still registered and still resolves", () => {
    // canonical() falls back to resolve() for a path with no canonical form, so
    // a checkout that is not here yet must not become unresolvable.
    const db = connect(":memory:");
    const project = createProject(db, { name: "Ghost" });
    const absent = join(tempDir(), "not", "here");
    addProjectPath(db, project.id, { path: absent });
    expect(resolveProjectsByPath(db, absent)[0]?.project.slug).toBe(project.slug);
    db.close();
  });
});

describe("scan and import", () => {
  const hasGit = gitAvailable();

  test.skipIf(!hasGit)("a scan describes a project from the checkouts it already has", async () => {
    const root = tempDir();
    const frontendOrigin = originRepo(root, "frontend");
    const backendOrigin = originRepo(root, "backend");

    const base = join(root, "Proyectos", "costia");
    mkdirSync(base, { recursive: true });
    git(["clone", "-q", frontendOrigin, join(base, "frontend")]);
    git(["clone", "-q", backendOrigin, join(base, "backend")]);

    const db = connect(":memory:");
    const store = new LocalTaskStore(db);
    const state = new LocalState(db);
    const project = await store.createProject({ name: "Costia" });
    state.addPath(project.id, { path: join(base, "frontend") });
    state.addPath(project.id, { path: join(base, "backend") });

    const scan = scanProject(state, project);
    expect(scan.base).toBe(base);
    expect(scan.repos.map((r) => r.key).sort()).toEqual(["backend", "frontend"]);
    expect(scan.repos.every((r) => r.remoteUrl !== null)).toBe(true);

    await applyScan(store, state, project, scan);
    expect((await store.listRepos(project.id)).map((r) => r.relativePath).sort()).toEqual(["backend", "frontend"]);
    db.close();
  });

  test.skipIf(!hasGit)("import clones what is missing and adopts what is already there", async () => {
    const root = tempDir();
    const frontendOrigin = originRepo(root, "frontend");
    const backendOrigin = originRepo(root, "backend");

    const db = connect(":memory:");
    const store = new LocalTaskStore(db);
    const state = new LocalState(db);
    const project = await store.createProject({ name: "Costia" });
    await store.upsertRepo(project.id, { key: "frontend", remoteUrl: frontendOrigin, relativePath: "frontend" });
    await store.upsertRepo(project.id, { key: "backend", remoteUrl: backendOrigin, relativePath: "backend" });
    await store.upsertRepo(project.id, { key: "secrets", relativePath: "secrets" });
    await store.upsertRepo(project.id, { key: "cluster", remoteUrl: "https://example.com/cluster", relativePath: null });

    // A second machine, with one of them already cloned by hand.
    const target = join(root, "nueva-maquina");
    mkdirSync(target, { recursive: true });
    git(["clone", "-q", backendOrigin, join(target, "backend")]);

    const plan = planImport(project, await store.listRepos(project.id), state.listPaths(project.id).map((p: { path: string }) => p.path), target);
    const byKey = Object.fromEntries(plan.entries.map((e) => [e.repo.key, e.action]));
    expect(byKey).toEqual({
      frontend: "clone",
      backend: "adopt",
      secrets: "no-remote",
      cluster: "unplaced",
    });

    const outcomes = executeImport(state, plan);
    expect(outcomes.filter((o) => o.result === "clone").length).toBe(1);
    expect(existsSync(join(target, "frontend", "README.md"))).toBe(true);
    expect(existsSync(join(target, "secrets"))).toBe(false);

    // Both live checkouts are registered, and re-running changes nothing.
    const again = planImport(project, await store.listRepos(project.id), state.listPaths(project.id).map((p: { path: string }) => p.path), target);
    expect(again.entries.filter((e) => e.action === "present").length).toBe(2);
    db.close();
  });

  test.skipIf(!hasGit)("a destination holding a different repository is stepped around", async () => {
    const root = tempDir();
    const wanted = originRepo(root, "wanted");
    const other = originRepo(root, "other");

    const db = connect(":memory:");
    const store = new LocalTaskStore(db);
    const state = new LocalState(db);
    const project = await store.createProject({ name: "Costia" });
    await store.upsertRepo(project.id, { key: "app", remoteUrl: wanted, relativePath: "app" });

    const target = join(root, "target");
    mkdirSync(target, { recursive: true });
    git(["clone", "-q", other, join(target, "app")]);

    const plan = planImport(project, await store.listRepos(project.id), state.listPaths(project.id).map((p: { path: string }) => p.path), target);
    expect(plan.entries[0]!.action).toBe("occupied");

    executeImport(state, plan);
    // Untouched: still the other repository, and not registered as ours.
    expect(detectRepo(join(target, "app"))?.remoteUrl).toContain("other");
    db.close();
  });

  test("repositories withheld by the server are counted, never named", async () => {
    const db = connect(":memory:");
    const store = new LocalTaskStore(db);
    const state = new LocalState(db);
    const project = await store.createProject({ name: "Costia" });
    state.setProjectBase(project.id, "/tmp/x");
    const plan = planImport(project, [], [], "/tmp/x", { withheld: ["secrets"] });
    const entry = plan.entries.find((e) => e.repo.key === "secrets")!;
    expect(entry.action).toBe("no-access");
    expect(entry.repo.remoteUrl).toBe(null);
    db.close();
  });
});

describe("machine identity", () => {
  const original = process.env.XDG_STATE_HOME;
  afterEach(() => {
    if (original === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = original;
    resetMachineCache();
  });

  test("an identity is generated once and then kept", async () => {
    process.env.XDG_STATE_HOME = tempDir();
    resetMachineCache();
    const first = machineId();
    resetMachineCache(); // as a fresh process would
    expect(machineId()).toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("two machines are two identities", async () => {
    process.env.XDG_STATE_HOME = tempDir();
    resetMachineCache();
    const one = machineId();
    process.env.XDG_STATE_HOME = tempDir();
    resetMachineCache();
    expect(machineId()).not.toBe(one);
  });

  test("registering claims the path rows written before machines existed", async () => {
    process.env.XDG_STATE_HOME = tempDir();
    resetMachineCache();

    const db = connect(":memory:");
    const store = new LocalTaskStore(db);
    const state = new LocalState(db);
    const project = await store.createProject({ name: "Costia" });
    addProjectPath(db, Number(project.id), { path: join(tempDir(), "costia") });
    // Migration 4 cannot write this in SQL: the identifier lives in a file.
    expect(listPaths(db, Number(project.id))[0]!.machineId).toBe(null);

    const id = registerMachine(db);
    expect(listPaths(db, Number(project.id))[0]!.machineId).toBe(id);

    // A second machine's rows are left alone.
    db.prepare("UPDATE project_paths SET machine_id = 'other' WHERE id = ?")
      .run(listPaths(db, Number(project.id))[0]!.id);
    registerMachine(db);
    expect(listPaths(db, Number(project.id))[0]!.machineId).toBe("other");
    db.close();
  });
});
