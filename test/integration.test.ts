import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspectInstallation, installIntegration, refreshIntegration, type InstallationOptions } from "@/lib/integration";
import { connect } from "@/lib/db";
import { createProject } from "@/lib/db/projects";
import { createTask } from "@/lib/db/tasks";
import { setStatuslineDefault, setStatuslineOverride } from "@/lib/db/settings";

const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture(): InstallationOptions {
  const directory = mkdtempSync(join(tmpdir(), "todos integration ' "));
  temporary.push(directory);
  const options = {
    root: join(directory, "plugin v1"), directory: join(directory, "state"),
    binDirectory: join(directory, "bin"), bun: process.execPath, windows: process.platform === "win32",
  };
  mkdirSync(join(options.root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(options.root, "bin"), { recursive: true });
  writeFileSync(join(options.root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "todos", version: "1.1.0" }));
  cpSync(resolve("bin/launcher.mjs"), join(options.root, "bin/launcher.mjs"));
  writeFileSync(join(options.root, "bin/todos.ts"), 'console.log(JSON.stringify(process.argv.slice(2)))');
  return options;
}

function run(options: InstallationOptions, args: string[], input?: string) {
  return spawnSync(process.execPath, [join(options.directory, "launcher.mjs"), ...args], {
    input, encoding: "utf8", timeout: 5000,
  });
}

describe("opt-in installation", () => {
  test("inspection and a hook with no registration create no state", () => {
    const options = fixture();
    expect(inspectInstallation(options).registered).toBe(false);
    refreshIntegration(options);
    expect(existsSync(options.directory)).toBe(false);
    expect(existsSync(options.binDirectory)).toBe(false);
  });

  test("statusline setup does not install a terminal command and is repeatable", () => {
    const options = fixture();
    installIntegration(false, options);
    const before = readFileSync(join(options.directory, "runtime.json"), "utf8");
    installIntegration(false, options);
    expect(readFileSync(join(options.directory, "runtime.json"), "utf8")).toBe(before);
    expect(existsSync(options.binDirectory)).toBe(false);
    expect(run(options, ["help"]).stdout.trim()).toBe('["help"]');
  });

  test("terminal launcher forwards arguments through paths with spaces and apostrophes", () => {
    const options = fixture();
    const result = installIntegration(true, options);
    const before = readFileSync(result.cli, "utf8");
    installIntegration(true, options);
    expect(readFileSync(result.cli, "utf8")).toBe(before);
    const child = options.windows
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", `""${result.cli}" help"`], { encoding: "utf8", windowsVerbatimArguments: true })
      : spawnSync(result.cli, ["help"], { encoding: "utf8" });
    expect(child.status).toBe(0);
    expect(child.stdout.trim()).toBe('["help"]');
  });

  test("an unrelated existing executable is not overwritten", () => {
    const options = fixture();
    mkdirSync(options.binDirectory);
    const cli = join(options.binDirectory, options.windows ? "todos.cmd" : "todos");
    writeFileSync(cli, "another application");
    expect(() => installIntegration(true, options)).toThrow("Nothing was overwritten");
    expect(readFileSync(cli, "utf8")).toBe("another application");
    expect(existsSync(options.directory)).toBe(false);
  });

  test("an update survives deletion of the old cache and cannot be downgraded", () => {
    const options = fixture();
    installIntegration(false, options);
    const next = { ...options, root: join(options.root, "..", "plugin v2") };
    cpSync(options.root, next.root, { recursive: true });
    writeFileSync(join(next.root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "todos", version: "1.2.0" }));
    refreshIntegration(next);
    refreshIntegration(options);
    expect(JSON.parse(readFileSync(join(options.directory, "runtime.json"), "utf8")).root).toBe(next.root);
    rmSync(options.root, { recursive: true });
    expect(run(options, ["help"]).stdout.trim()).toBe('["help"]');
  });

  test("a new version at an unchanged path still ships its new launcher", () => {
    const options = fixture();
    installIntegration(false, options);
    writeFileSync(join(options.root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "todos", version: "1.2.0" }));
    writeFileSync(join(options.root, "bin/launcher.mjs"), 'console.log("a newer launcher")');
    refreshIntegration(options);
    const registration = JSON.parse(readFileSync(join(options.directory, "runtime.json"), "utf8"));
    expect(registration.version).toBe("1.2.0");
    expect(readFileSync(join(options.directory, "launcher.mjs"), "utf8")).toBe('console.log("a newer launcher")');
  });

  test("a refresh keeps the environment captured when the user opted in", () => {
    const options = fixture();
    const chosen = join(options.root, "chosen.db");
    const previous = process.env.CLAUDE_TASKS_DB;
    try {
      process.env.CLAUDE_TASKS_DB = chosen;
      installIntegration(false, options);
      process.env.CLAUDE_TASKS_DB = join(options.root, "just this session.db");
      const next = { ...options, root: join(options.root, "..", "plugin moved") };
      cpSync(options.root, next.root, { recursive: true });
      refreshIntegration(next);
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_TASKS_DB;
      else process.env.CLAUDE_TASKS_DB = previous;
    }
    expect(JSON.parse(readFileSync(join(options.directory, "runtime.json"), "utf8")).environment.CLAUDE_TASKS_DB)
      .toBe(chosen);
  });

  test("another todos earlier on PATH is reported but does not block installation", () => {
    const options = fixture();
    const foreign = join(options.root, "..", "foreign bin");
    mkdirSync(foreign, { recursive: true });
    const command = join(foreign, options.windows ? "todos.cmd" : "todos");
    writeFileSync(command, options.windows ? "@echo off\r\n" : "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const previous = process.env.PATH;
    try {
      process.env.PATH = `${foreign}${options.windows ? ";" : ":"}${previous}`;
      const before = inspectInstallation(options);
      expect(before.conflict).toBe(null);
      expect(before.shadowedBy).toBe(command);
      const result = installIntegration(true, options);
      expect(result.cliInstalled).toBe(true);
      expect(result.conflict).toBe(null);
    } finally { process.env.PATH = previous; }
  });

  test("the real session hook refreshes an opted-in integration even in quiet mode", () => {
    const fixtureOptions = fixture();
    const state = join(fixtureOptions.root, "..", "hook state");
    const options = { ...fixtureOptions, directory: join(state, "claude-tasks", "integration") };
    installIntegration(false, options);
    const database = join(state, "must-not-create.db");
    const result = spawnSync(process.execPath, [resolve("hooks/session-start.ts")], {
      encoding: "utf8", input: "{}",
      env: { ...process.env, XDG_STATE_HOME: state, CLAUDE_TASKS_DB: database, CLAUDE_TODOS_QUIET: "1" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(existsSync(database)).toBe(false);
    expect(JSON.parse(readFileSync(join(options.directory, "runtime.json"), "utf8")).root).toBe(resolve("."));
  });
});

describe("statusline launcher", () => {
  test("compact rendering passes the JSON workspace directory without consuming it in the segment", () => {
    const options = fixture();
    installIntegration(false, options);
    const result = run(options, ["--claude"], JSON.stringify({
      model: { display_name: "Example" }, context_window: { used_percentage: 42.4 },
      cwd: "/fallback", workspace: { current_dir: "/project with spaces" },
    }));
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('Example · ctx 42% · ["statusline","--cwd","/project with spaces"]');
    expect(result.stderr).toBe("");
  });

  test("empty, failed and missing task runtimes leave the compact bar intact", () => {
    const options = fixture();
    installIntegration(false, options);
    for (const code of ["", 'console.error("private error"); process.exit(1)']) {
      writeFileSync(join(options.root, "bin/todos.ts"), code);
      const result = run(options, ["--claude"], '{"model":{"display_name":"Example"}}');
      expect(result.stdout).toBe("Example\n");
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    }
    rmSync(options.root, { recursive: true });
    expect(run(options, ["--claude"], '{"model":{"display_name":"Example"}}').stdout).toBe("Example\n");
    expect(run(options, ["statusline"]).stdout).toBe("");
    expect(run(options, ["help"]).status).toBe(1);
  });

  test("a slow segment is terminated without breaking other fields", () => {
    const options = fixture();
    installIntegration(false, options);
    writeFileSync(join(options.root, "bin/todos.ts"), 'await new Promise(r => setTimeout(r, 10000)); console.log("late")');
    const start = Date.now();
    const result = run(options, ["--claude"], '{"model":{"display_name":"Example"}}');
    expect(result.stdout).toBe("Example\n");
    expect(result.status).toBe(0);
    expect(Date.now() - start).toBeLessThan(4000);
  });

  test("invalid input does not crash the compact bar", () => {
    const options = fixture();
    installIntegration(false, options);
    writeFileSync(join(options.root, "bin/todos.ts"), "");
    for (const input of ["", "{bad json", "null"]) {
      const result = run(options, ["--claude"], input);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    }
  });
});

test("real CLI uses --cwd and respects visibility without reading stdin", () => {
  const options = fixture();
  const database = join(options.root, "test.db");
  const db = connect(database);
  const cwd = join(options.root, "project");
  const project = createProject(db, { name: "A project", paths: [{ path: cwd }] });
  createTask(db, { projectId: project.id, title: "Manual work", steps: [{ title: "Do it" }] });
  const invoke = (path: string) => spawnSync(process.execPath, [resolve("bin/todos.ts"), "statusline", "--cwd", path], {
    input: "not JSON", encoding: "utf8", env: { ...process.env, CLAUDE_TASKS_DB: database },
  });
  try {
    expect(invoke(cwd).stdout).toBe("◆ A project · 1 open\n");
    expect(invoke(join(options.root, "unrelated")).stdout).toBe("");
    setStatuslineDefault(db, false);
    expect(invoke(cwd).stdout).toBe("");
    setStatuslineOverride(db, project.slug, true);
    expect(invoke(cwd).stdout).toBe("◆ A project · 1 open\n");
  } finally { db.close(); }
});

test("setup refuses to both inspect and install at once", () => {
  const result = spawnSync(process.execPath, [resolve("bin/todos.ts"), "setup", "--check", "--statusline"], {
    encoding: "utf8",
  });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("Usage: todos setup");
  expect(result.stdout).toBe("");
});
