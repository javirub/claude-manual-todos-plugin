#!/usr/bin/env bun
/**
 * The terminal surface: the board's controls, and the only way to read the list
 * without spending a model turn.
 *
 * The lifecycle itself lives in @/lib/board-process, because the MCP server needs
 * it too and must not import the status line and the installer to get at it.
 *
 * Everything here exists because a slash command costs a turn and this does not.
 * Inside a Claude Code session, `!todos` runs it locally with no inference at all;
 * `todos statusline` is what the status bar calls on every render.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { getLocalState, getStore } from "@/lib/core";
import { getDb } from "@/lib/db";
import type { LocalState } from "@/lib/core/local-state";
import type { TaskStore } from "@/lib/core/port";
import type { Project } from "@/lib/core/types";
import { databasePath, boardPort } from "@/lib/db/paths";
import { digestFor, statuslineSegment, terminalDigest } from "@/lib/digest";
import { applyScan, executeImport, planImport, scanProject } from "@/lib/import";
import { gitAvailable } from "@/lib/git";
import { importPlanText, importResultText, repoListText, scanText } from "@/lib/format/repos";
import { machineLabel, setMachineLabel } from "@/lib/machine";
import { pollForToken, requestDeviceCode } from "@/lib/auth";
import { clearCredentials, readCredentials } from "@/lib/credentials";
import { currentMode } from "@/lib/core";
import { getSetting, setSetting } from "@/lib/db/settings";
import { ensureUp, isBuilt, isUp, stopBoard } from "@/lib/board-process";
import { boardHome, projectUrl } from "@/lib/permalink";
import { IS_WINDOWS, PLUGIN_ROOT, openerCommand } from "@/lib/runtime";
import { inspectInstallation, installIntegration } from "@/lib/integration";

const ROOT = PLUGIN_ROOT;

const store: TaskStore = getStore();
const state: LocalState = getLocalState();

function openInBrowser(target: string): void {
  const opener = openerCommand(target);
  spawn(opener.command, opener.args, { detached: true, stdio: "ignore" }).unref();
}

/* ------------------------------------------------------------- statusline */

/**
 * `todos statusline` with no verb prints the segment; with one it sets whether
 * the segment shows, for this project or for every project.
 *
 * The read path is what the status bar calls on every render, so it never
 * throws and never prints a diagnostic: an empty line is the correct output for
 * "no project here", "turned off" and "the database is busy" alike.
 */
async function statusline(rest: string[], cwd: string): Promise<number> {
  const cwdIndex = rest.indexOf("--cwd");
  if (cwdIndex !== -1) {
    const explicit = rest[cwdIndex + 1];
    if (!explicit || explicit.startsWith("--")) return 0;
    cwd = resolve(explicit);
    rest = rest.filter((_, index) => index !== cwdIndex && index !== cwdIndex + 1);
  }
  const global = rest.includes("--global");
  const verb = rest.find((a) => !a.startsWith("--"));

  if (!verb) {
    try {
      const digest = await digestFor(store, state, cwd);
      if (!digest || !digest.open.length) return 0;
      if (!state.statuslineEnabledFor(digest.project.slug)) return 0;
      console.log(statuslineSegment(digest));
    } catch {
      /* Never the reason someone's status bar breaks. */
    }
    return 0;
  }

  if (verb === "status") {
    const digest = await digestFor(store, state, cwd);
    console.log(`Default: ${state.statuslineDefault() ? "on" : "off"}`);
    if (!digest) {
      console.log("This directory belongs to no project, so nothing would show here anyway.");
      return 0;
    }
    const override = state.statuslineOverride(digest.project.slug);
    console.log(
      `${digest.project.name}: ${override === null ? "inherits the default" : override ? "on" : "off"} ` +
        `→ ${state.statuslineEnabledFor(digest.project.slug) ? "shows" : "hidden"}`,
    );
    return 0;
  }

  if (verb !== "on" && verb !== "off" && verb !== "default") {
    console.error("Usage: todos statusline [on | off | default | status] [--global]");
    return 2;
  }

  if (global) {
    if (verb === "default") {
      console.error("--global is the default. Use on or off.");
      return 2;
    }
    state.setStatuslineDefault(verb === "on");
    console.log(`The statusline is ${verb} for every project that has no opinion of its own.`);
    return 0;
  }

  const digest = await digestFor(store, state, cwd);
  if (!digest) {
    console.error(
      "This directory belongs to no project. Use --global to set the default, " +
        "or register the path first with add_project_path.",
    );
    return 1;
  }
  state.setStatuslineOverride(digest.project.slug, verb === "default" ? null : verb === "on");
  console.log(
    verb === "default"
      ? `${digest.project.name} now follows the default (${state.statuslineDefault() ? "on" : "off"}).`
      : `The statusline is ${verb} for ${digest.project.name}.`,
  );
  return 0;
}

/* -------------------------------------------------------------- checkouts */

/** The project a command is about: named, or the one this directory belongs to. */
async function projectFor(name: string | undefined, cwd: string): Promise<Project> {
  if (name) {
    const found = await store.getProject(name);
    if (found) return found;
    const known = (await store.listProjects()).map((p) => p.slug).join(", ") || "none";
    throw new Error(`No project "${name}". The ones that exist: ${known}.`);
  }
  const here = state.resolve(cwd)[0];
  if (!here) throw new Error(`${cwd} belongs to no project. Name one, or run this from inside a checkout.`);
  return (await store.getProject(here.projectSlug))!;
}

function flag(rest: string[], name: string): string | undefined {
  const index = rest.indexOf(name);
  if (index === -1) return undefined;
  const value = rest[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function positional(rest: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg.startsWith("--")) {
      // The flags that take a value swallow the next argument.
      if (["--into", "--only", "--label"].includes(arg)) i += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

/**
 * Asks before cloning.
 *
 * The point of the prompt is that everything below it happens outside any
 * directory this plugin owns. A non-interactive stdin answers no rather than
 * yes: a script that meant to clone says --yes, and one that did not should not
 * discover the difference afterwards.
 */
async function confirmed(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(`${question} [y/N] `);
  const answer = await new Promise<string>((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (chunk) => resolve(String(chunk).trim().toLowerCase()));
    process.stdin.resume();
  });
  process.stdin.pause();
  return answer === "y" || answer === "yes";
}

async function repos(rest: string[], cwd: string): Promise<number> {
  state.register();
  const project = await projectFor(positional(rest)[0], cwd);

  if (rest.includes("--scan")) {
    if (!gitAvailable()) {
      console.error("git is not on PATH, so there is nothing to ask about these checkouts.");
      return 1;
    }
    const scan = scanProject(state, project);
    console.log(scanText(scan, project.name));
    if (rest.includes("--dry-run")) {
      console.log("\nNothing written. Run without --dry-run to record it.");
      return 0;
    }
    const written = await applyScan(store, state, project, scan);
    console.log(`\nRecorded ${written} repositor${written === 1 ? "y" : "ies"}.`);
    return 0;
  }

  const paths = state.listPaths(project.id);
  const presentAt = (repo: { id: string }) => paths.find((p) => p.repoId === repo.id)?.path ?? null;
  console.log(`${project.name}\n${repoListText(await store.listRepos(project.id), presentAt)}`);
  return 0;
}

async function base(rest: string[], cwd: string): Promise<number> {
  state.register();
  const args = positional(rest);
  // `todos base <path>` inside a project, or `todos base <project> <path>`.
  const [first, second] = args;
  const project = await projectFor(second ? first : undefined, cwd);
  const path = second ?? first;

  if (!path) {
    const recorded = state.projectBase(project.id);
    console.log(recorded ? `${project.name} lives under ${recorded} on ${machineLabel()}.`
                         : `No base directory recorded for ${project.name} on ${machineLabel()}.`);
    return recorded ? 0 : 1;
  }
  console.log(`${project.name} lives under ${state.setProjectBase(project.id, path)} on ${machineLabel()}.`);
  return 0;
}

async function importCommand(rest: string[], cwd: string): Promise<number> {
  if (!gitAvailable()) {
    console.error("git is not on PATH, so nothing can be cloned.");
    return 1;
  }
  state.register();

  const into = flag(rest, "--into");
  const only = flag(rest, "--only")?.split(",").map((k) => k.trim()).filter(Boolean);
  const all = rest.includes("--all");
  const args = positional(rest);

  const projects = all ? await store.listProjects() : [await projectFor(args[0], cwd)];
  let failures = 0;

  for (const project of projects) {
    const recorded = state.projectBase(project.id);
    const chosen = into ?? recorded;
    if (!chosen) {
      console.error(`No base directory for ${project.slug}. Pass --into <dir>, or set one with "todos base".`);
      failures += 1;
      continue;
    }

    const plan = planImport(
      project,
      await store.listRepos(project.id),
      state.listPaths(project.id).map((p) => p.path),
      resolve(chosen),
      { only },
    );
    console.log(importPlanText(plan));

    const willClone = plan.entries.some((e) => e.action === "clone");
    if (!willClone) {
      // Still worth recording the base: it is what makes the next import work.
      executeImport(state, plan);
      console.log("");
      continue;
    }
    if (!rest.includes("--yes") && !(await confirmed("\nClone these?"))) {
      console.log("Nothing was written.");
      continue;
    }

    const outcomes = executeImport(state, plan);
    console.log(`\n${importResultText(plan, outcomes)}\n`);
    failures += outcomes.filter((o) => o.result === "failed").length;
  }

  return failures ? 1 : 0;
}

/**
 * Turns a thrown message into a line and an exit code.
 *
 * These commands fail for ordinary reasons — a project that is not there, a
 * directory that belongs to nothing — and a stack trace is the wrong way to say
 * so to someone in a terminal.
 */
async function guard(run: () => number | Promise<number>): Promise<number> {
  try {
    return await run();
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

function machine(rest: string[]): number {
  let id = state.register();
  const label = positional(rest)[0];
  if (label) {
    setMachineLabel(label);
    id = state.register();
  }
  console.log(`${machineLabel()}  ${id}`);
  return 0;
}

/* ----------------------------------------------------------------- account */

const DEFAULT_API = "https://api.todos.dev";

/**
 * Signs this machine in.
 *
 * Prints a code and waits. Everything about that is on purpose: the person
 * approving it is doing so in a browser we do not control, on a device that may
 * not be this one, and what comes back belongs to this computer rather than to
 * them — so the token can be revoked here without touching anything else they
 * are signed in to.
 */
async function login(rest: string[]): Promise<number> {
  const db = getDb();
  const api = flag(rest, "--api") ?? getSetting(db, "cloud.api") ?? DEFAULT_API;

  const device = await requestDeviceCode(api);
  console.log(`\n  ${device.userCode}\n`);
  console.log(`Open ${device.verificationUriComplete ?? device.verificationUri} and approve that code.`);
  if (rest.includes("--open") && device.verificationUriComplete) openInBrowser(device.verificationUriComplete);
  console.log("Waiting…");

  const credentials = await pollForToken(api, device, {
    onSlowDown: (interval) => console.log(`(asked to slow down; checking every ${interval}s)`),
  });

  setSetting(db, "cloud.api", api);
  setSetting(db, "mode", "cloud");

  // Which workspace to work in. One is not a choice worth asking about.
  const me = await fetch(`${api.replace(/\/+$/, "")}/v1/me`, {
    headers: { authorization: `Bearer ${credentials.accessToken}` },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  const workspaces: Array<{ slug: string; name: string }> = me?.workspaces ?? [];
  const chosen = flag(rest, "--workspace") ?? workspaces[0]?.slug;
  if (chosen) setSetting(db, "cloud.workspace", chosen);

  console.log(`\nSigned in as ${me?.email ?? "this device"}.`);
  if (workspaces.length > 1) {
    console.log(`Workspaces: ${workspaces.map((w) => w.slug).join(", ")} — using ${chosen}.`);
    console.log(`Change it with "todos workspace <slug>".`);
  }
  console.log(`Cloud mode is on. "todos mode local" goes back to the database on this machine,`);
  console.log(`which is untouched and exactly as you left it.`);
  return 0;
}

function logout(): number {
  const db = getDb();
  clearCredentials();
  setSetting(db, "mode", "local");
  console.log("Signed out. Back on the local database, exactly as you left it.");
  return 0;
}

async function whoami(): Promise<number> {
  const credentials = readCredentials();
  if (!credentials) {
    console.log(`Not signed in. Mode: ${currentMode()}.`);
    return 1;
  }
  const db = getDb();
  const api = credentials.api || getSetting(db, "cloud.api") || DEFAULT_API;
  const me = await fetch(`${api.replace(/\/+$/, "")}/v1/me`, {
    headers: { authorization: `Bearer ${credentials.accessToken}` },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  if (!me) {
    console.log(`Signed in to ${api}, but it did not answer. Token expires ${new Date(credentials.expiresAt).toISOString()}.`);
    return 1;
  }
  console.log(`${me.email} at ${api}`);
  console.log(`Workspace: ${getSetting(db, "cloud.workspace") ?? "(none chosen)"}`);
  console.log(`Mode: ${currentMode()} · machine: ${machineLabel()}`);
  return 0;
}

/**
 * Switches between the local database and the hosted one.
 *
 * Says out loud that nothing is merged, because that is the single most
 * confusable thing about this: the two are separate places, and moving between
 * them changes which one you are looking at rather than combining them.
 */
function mode(rest: string[]): number {
  const db = getDb();
  const wanted = positional(rest)[0];
  if (!wanted) {
    console.log(currentMode());
    return 0;
  }
  if (wanted !== "local" && wanted !== "cloud") {
    console.error('Usage: todos mode [local | cloud]');
    return 2;
  }
  if (wanted === "cloud" && !readCredentials()) {
    console.error('Not signed in. Run "todos login" first.');
    return 1;
  }
  setSetting(db, "mode", wanted);
  console.log(
    wanted === "cloud"
      ? "Cloud mode. Your local tasks stay where they are; nothing is copied either way."
      : "Local mode. The database on this machine, exactly as you left it.",
  );
  return 0;
}

function workspace(rest: string[]): number {
  const db = getDb();
  const wanted = positional(rest)[0];
  if (!wanted) {
    console.log(getSetting(db, "cloud.workspace") ?? "(none chosen)");
    return 0;
  }
  setSetting(db, "cloud.workspace", wanted);
  console.log(`Working in ${wanted}.`);
  return 0;
}

/* ----------------------------------------------------------------- doctor */

/** Everything that has to be true for the plugin to work, checked one by one. */
async function doctor(cwd: string): Promise<number> {
  const lines: string[] = [];
  let bad = 0;

  const ok = (label: string, detail: string) => lines.push(`  ok    ${label.padEnd(14)} ${detail}`);
  const warn = (label: string, detail: string) => lines.push(`  warn  ${label.padEnd(14)} ${detail}`);
  const fail = (label: string, detail: string) => {
    bad += 1;
    lines.push(`  FAIL  ${label.padEnd(14)} ${detail}`);
  };

  // Bun. The one hard requirement, and the one most often behind a version
  // manager whose shims are not on the PATH a GUI-launched client inherits.
  const which = spawnSync(IS_WINDOWS ? "where" : "which", ["bun"], { encoding: "utf8" });
  const onPath = which.status === 0 ? which.stdout.split(/\r?\n/)[0]?.trim() : "";
  if (onPath) {
    const shim = /\/(mise|asdf|\.asdf|fnm|volta)\//.test(onPath);
    const version = spawnSync(onPath, ["--version"], { encoding: "utf8" }).stdout?.trim() ?? "?";
    if (shim) {
      warn(
        "bun",
        `${onPath} (${version}) — this is a version-manager shim. It resolves in your shell, ` +
          `but the process that spawns MCP servers may not see it. See Troubleshooting in the README.`,
      );
    } else {
      ok("bun", `${onPath} (${version})`);
    }
  } else {
    fail("bun", "not on PATH. Everything here runs on it; install it and reopen your shell.");
  }

  // The database.
  const dbPath = databasePath();
  let known: Project[] = [];
  try {
    known = await store.listProjects();
    ok("database", `${dbPath} — ${known.length} project${known.length === 1 ? "" : "s"}`);
  } catch (error) {
    fail("database", `${dbPath} — ${(error as Error).message}`);
  }

  // Where we are.
  try {
    const digest = await digestFor(store, state, cwd);
    if (digest) ok("this directory", `${digest.project.name} (${digest.open.length} open)`);
    else warn("this directory", `${cwd} belongs to no project yet.`);
  } catch (error) {
    fail("this directory", (error as Error).message);
  }

  // The build, which is the difference between the board opening now and in
  // twenty seconds.
  if (isBuilt()) ok("board build", "built — starts immediately");
  else warn("board build", `not built. Run "bun run build" in ${ROOT} so it stops falling back to dev.`);

  // Dependencies.
  if (existsSync(join(ROOT, "node_modules", "@modelcontextprotocol", "server", "package.json"))) {
    ok("dependencies", "installed");
  } else {
    warn("dependencies", `missing — the MCP server installs them itself on first start.`);
  }

  // git, which everything about checkouts depends on.
  if (gitAvailable()) ok("git", "available");
  else warn("git", "not on PATH — todos repos and todos import need it.");

  // Repositories recorded but not checked out here.
  try {
    state.register();
    let absent = 0;
    for (const project of known) {
      const paths = state.listPaths(project.id);
      absent += (await store.listRepos(project.id)).filter(
        (repo) => !paths.some((p) => p.repoId === repo.id),
      ).length;
    }
    if (absent) warn("checkouts", `${absent} recorded repositor${absent === 1 ? "y is" : "ies are"} not on this machine. "todos import" clones them.`);
    else ok("checkouts", `all recorded repositories are here (${machineLabel()})`);
  } catch (error) {
    fail("checkouts", (error as Error).message);
  }

  // The port.
  const up = await isUp();
  if (up) ok("board", `up at ${boardHome()}`);
  else ok("board", `not running (it starts on demand, port ${boardPort()})`);

  console.log(`todos doctor — ${ROOT}\n\n${lines.join("\n")}\n`);
  return bad > 0 ? 1 : 0;
}

/* ------------------------------------------------------------------ setup */

/** Stable launchers; --check never installs, --statusline does not install the CLI. */
function setup(rest: string[]): number {
  const unknown = rest.some(arg => !["--check", "--json", "--statusline"].includes(arg));
  // --check inspects and --statusline installs: asking for both says nothing.
  if (unknown || (rest.includes("--check") && rest.includes("--statusline"))) {
    console.error("Usage: todos setup [--check | --statusline] [--json]");
    return 2;
  }
  try {
    const result = rest.includes("--check")
      ? inspectInstallation()
      : installIntegration(!rest.includes("--statusline"));
    if (rest.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`CLI: ${result.cli}${result.cliInstalled ? " (installed)" : " (not installed)"}`);
      if (result.conflict) console.log(`Conflict: ${result.conflict}`);
      if (result.shadowedBy) console.log(`Another todos comes first on your PATH: ${result.shadowedBy}. Ours runs only once ${result.binDirectory} precedes it.`);
      if (!result.onPath) console.log(`To use todos in a new terminal, add ${result.binDirectory} to your user PATH.`);
      console.log(`Bun: ${result.bun}\nStable launcher: ${result.launcher}`);
      console.log("Run /todos:statusline in Claude Code to configure the bar, or /todos:onboarding for guided setup.");
    }
    return 0;
  } catch (error) {
    console.error(`Could not configure todos: ${(error as Error).message}`);
    return 1;
  }
}

/* ------------------------------------------------------------------- main */

const USAGE = `todos — the manual tasks only you can do

  todos                    open the board on this project and print what is pending
  todos pending            print what is pending, without a browser
  todos serve              bring the board up
  todos stop               take it down
  todos status             is it up?
  todos url                print the board's origin
  todos open [path]        open the board, at a path if you give one
  todos statusline         print the status-bar segment for this directory
  todos statusline on|off|default|status [--global]
  todos repos [project]    the repositories this project is made of
  todos repos --scan       describe the project from the checkouts it already has
  todos base [project] <dir>   where this project lives on this machine
  todos import [project] --into <dir>   clone what is missing, adopt what is here
  todos import --all --into <dir> [--only a,b] [--yes]
  todos machine [label]    this machine's identity
  todos login [--api <url>] [--open]   sign this machine in to the hosted service
  todos logout             sign out and go back to the local database
  todos whoami             who this machine is signed in as
  todos mode [local|cloud] which of the two you are working in
  todos workspace [slug]   which workspace, in cloud mode
  todos doctor             check everything that has to be true for this to work
  todos setup              install the stable terminal launcher
  todos setup --check --json  inspect integrations without changing files
  todos setup --statusline --json  prepare only the statusline launcher (no CLI)
  todos statusline --cwd <path>  print a segment for an explicit directory`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const cwd = process.cwd();

  switch (command ?? "board") {
    case "board": {
      const digest = await digestFor(store, state, cwd);
      const { url } = await ensureUp();
      const target = digest ? projectUrl(digest.project.slug) : url;
      openInBrowser(target);
      console.log(digest ? `${terminalDigest(digest)}\n\n${target}` : `No project for ${cwd}.\n\n${target}`);
      return;
    }
    case "pending": {
      const digest = await digestFor(store, state, cwd);
      if (!digest) {
        console.log(`${cwd} belongs to no project. Claude registers one the first time it leaves you something.`);
        process.exitCode = 1;
        return;
      }
      console.log(terminalDigest(digest));
      return;
    }
    case "status": {
      const up = await isUp();
      console.log(up ? `Up at ${boardHome()}` : "Stopped.");
      process.exitCode = up ? 0 : 1;
      return;
    }
    case "serve": {
      const { url, started } = await ensureUp();
      console.log(started ? `Started at ${url}` : `Already up at ${url}`);
      return;
    }
    case "stop":
      console.log(stopBoard());
      return;
    case "url":
      console.log(boardHome());
      return;
    case "open": {
      const { url } = await ensureUp();
      const target = rest[0] ? new URL(rest[0], url).toString() : url;
      openInBrowser(target);
      console.log(target);
      return;
    }
    case "statusline":
      process.exitCode = await statusline(rest, cwd);
      return;
    case "repos":
      process.exitCode = await guard(() => repos(rest, cwd));
      return;
    case "base":
      process.exitCode = await guard(() => base(rest, cwd));
      return;
    case "import":
      process.exitCode = await guard(() => importCommand(rest, cwd));
      return;
    case "machine":
      process.exitCode = await guard(() => machine(rest));
      return;
    case "login":
      process.exitCode = await guard(() => login(rest));
      return;
    case "logout":
      process.exitCode = await guard(() => logout());
      return;
    case "whoami":
      process.exitCode = await guard(() => whoami());
      return;
    case "mode":
      process.exitCode = await guard(() => mode(rest));
      return;
    case "workspace":
      process.exitCode = await guard(() => workspace(rest));
      return;
    case "doctor":
      process.exitCode = await doctor(cwd);
      return;
    case "setup":
      process.exitCode = setup(rest);
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return;
    default:
      console.error(`Unknown command "${command}".\n\n${USAGE}`);
      process.exitCode = 2;
  }
}

if (import.meta.main) await main();
