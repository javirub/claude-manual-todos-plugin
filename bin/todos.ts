#!/usr/bin/env bun
/**
 * The board's lifecycle, and the only way to read the list without spending a
 * model turn.
 *
 * The MCP server calls into `ensureUp` so that "register a task" and "look at
 * the board" stay independent: writing never needs the server to be up, and
 * bringing it up is a single idempotent call.
 *
 * Everything else here exists because a slash command costs a turn and this does
 * not. Inside a Claude Code session, `!todos` runs it locally with no inference
 * at all; `todos statusline` is what the status bar calls on every render.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureDependencies } from "../mcp/preflight";
import { connect } from "@/lib/db";
import { boardOrigin, boardPort, databasePath, stateDir } from "@/lib/db/paths";
import { listProjects } from "@/lib/db/projects";
import {
  getStatuslineDefault,
  getStatuslineOverride,
  setStatuslineDefault,
  setStatuslineOverride,
  statuslineEnabledFor,
} from "@/lib/db/settings";
import { digestFor, statuslineSegment, terminalDigest } from "@/lib/digest";
import { IS_WINDOWS, bunExecutable, openerCommand } from "@/lib/runtime";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PID_FILE = join(stateDir(), "board.pid");
const LOG_FILE = join(stateDir(), "board.log");

export async function isUp(timeoutMs = 500): Promise<boolean> {
  try {
    const response = await fetch(`${boardOrigin()}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function readPid(): number | null {
  try {
    const pid = Number.parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
    if (!Number.isFinite(pid)) return null;
    process.kill(pid, 0); // throws if the process is gone
    return pid;
  } catch {
    return null;
  }
}

/**
 * A built app starts in well under a second; an unbuilt one has to compile on
 * demand, so `dev` is the honest fallback rather than a silent failure.
 */
function chooseScript(): "start" | "dev" {
  return existsSync(join(ROOT, ".next", "BUILD_ID")) ? "start" : "dev";
}

export async function ensureUp(): Promise<{ url: string; started: boolean }> {
  if (await isUp()) return { url: boardOrigin(), started: false };

  // A checkout straight from the marketplace has no node_modules and no build.
  ensureDependencies();
  mkdirSync(stateDir(), { recursive: true });
  const log = openSync(LOG_FILE, "a");
  const script = chooseScript();

  const child = spawn(bunExecutable(), ["run", script], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", log, log],
    // Next reads PORT; passing it here keeps shell syntax out of package.json,
    // which is the only way the scripts work on Windows too.
    env: { ...process.env, PORT: String(boardPort()), CLAUDE_TASKS_PORT: String(boardPort()) },
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid ?? ""));

  // A cold `next dev` compiles the first page on request, so the budget is
  // generous; a built server answers on the first or second poll.
  const deadline = Date.now() + (script === "dev" ? 90_000 : 30_000);
  while (Date.now() < deadline) {
    if (await isUp(1000)) return { url: boardOrigin(), started: true };
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `The board did not answer on ${boardOrigin()} after starting it with "bun run ${script}". See ${LOG_FILE}.`,
  );
}

function stop(): string {
  const pid = readPid();
  if (!pid) return "The board is not running.";

  if (IS_WINDOWS) {
    // There are no process groups to signal here, and Next leaves a child of its
    // own behind: /T takes the tree with it.
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    process.kill(-pid, "SIGTERM"); // the whole detached group, not just bun
  }

  try {
    unlinkSync(PID_FILE);
  } catch {
    /* already gone */
  }
  return `Stopped (pid ${pid}).`;
}

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
function statusline(rest: string[], cwd: string): number {
  const global = rest.includes("--global");
  const verb = rest.find((a) => !a.startsWith("--"));

  if (!verb) {
    try {
      const digest = digestFor(cwd);
      if (!digest || !digest.open.length) return 0;
      if (!statuslineEnabledFor(connect(), digest.project.slug)) return 0;
      console.log(statuslineSegment(digest));
    } catch {
      /* Never the reason someone's status bar breaks. */
    }
    return 0;
  }

  const db = connect();

  if (verb === "status") {
    const digest = digestFor(cwd, db);
    console.log(`Default: ${getStatuslineDefault(db) ? "on" : "off"}`);
    if (!digest) {
      console.log("This directory belongs to no project, so nothing would show here anyway.");
      return 0;
    }
    const override = getStatuslineOverride(db, digest.project.slug);
    console.log(
      `${digest.project.name}: ${override === null ? "inherits the default" : override ? "on" : "off"} ` +
        `→ ${statuslineEnabledFor(db, digest.project.slug) ? "shows" : "hidden"}`,
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
    setStatuslineDefault(db, verb === "on");
    console.log(`The statusline is ${verb} for every project that has no opinion of its own.`);
    return 0;
  }

  const digest = digestFor(cwd, db);
  if (!digest) {
    console.error(
      "This directory belongs to no project. Use --global to set the default, " +
        "or register the path first with add_project_path.",
    );
    return 1;
  }
  setStatuslineOverride(db, digest.project.slug, verb === "default" ? null : verb === "on");
  console.log(
    verb === "default"
      ? `${digest.project.name} now follows the default (${getStatuslineDefault(db) ? "on" : "off"}).`
      : `The statusline is ${verb} for ${digest.project.name}.`,
  );
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
  try {
    const db = connect();
    const projects = listProjects(db);
    ok("database", `${dbPath} — ${projects.length} project${projects.length === 1 ? "" : "s"}`);
  } catch (error) {
    fail("database", `${dbPath} — ${(error as Error).message}`);
  }

  // Where we are.
  try {
    const digest = digestFor(cwd);
    if (digest) ok("this directory", `${digest.project.name} (${digest.open.length} open)`);
    else warn("this directory", `${cwd} belongs to no project yet.`);
  } catch (error) {
    fail("this directory", (error as Error).message);
  }

  // The build, which is the difference between the board opening now and in
  // twenty seconds.
  if (existsSync(join(ROOT, ".next", "BUILD_ID"))) ok("board build", "built — starts immediately");
  else warn("board build", `not built. Run "bun run build" in ${ROOT} so it stops falling back to dev.`);

  // Dependencies.
  if (existsSync(join(ROOT, "node_modules", "@modelcontextprotocol", "server", "package.json"))) {
    ok("dependencies", "installed");
  } else {
    warn("dependencies", `missing — the MCP server installs them itself on first start.`);
  }

  // The port.
  const up = await isUp();
  if (up) ok("board", `up at ${boardOrigin()}`);
  else ok("board", `not running (it starts on demand, port ${boardPort()})`);

  console.log(`todos doctor — ${ROOT}\n\n${lines.join("\n")}\n`);
  return bad > 0 ? 1 : 0;
}

/* ------------------------------------------------------------------ setup */

/** Puts the CLI on PATH and prints the statusline snippet. Writes nothing else. */
function setup(): number {
  const target = join(ROOT, "bin", "todos.ts");
  const binDir = join(homedir(), ".local", "bin");
  const link = join(binDir, "todos");

  if (IS_WINDOWS) {
    console.log(`Add this directory to your PATH, or make a shim for it:\n  ${join(ROOT, "bin")}\n`);
  } else {
    try {
      mkdirSync(binDir, { recursive: true });
      try {
        unlinkSync(link);
      } catch {
        /* nothing there yet */
      }
      symlinkSync(target, link);
      console.log(`Linked ${link} → ${target}`);
      if (!(process.env.PATH ?? "").split(":").includes(binDir)) {
        console.log(`${binDir} is not on your PATH. Add it to your shell profile.`);
      }
    } catch (error) {
      console.error(`Could not link into ${binDir}: ${(error as Error).message}`);
      return 1;
    }
  }

  console.log(
    `\nFor the statusline, in ~/.claude/settings.json:\n\n` +
      `  "statusLine": {\n` +
      `    "type": "command",\n` +
      `    "command": "bun ${target} statusline"\n` +
      `  }\n\n` +
      `Already have one? Append the segment to it instead:\n\n` +
      `  your-statusline; bun ${target} statusline\n\n` +
      `Turn it off per project with "todos statusline off", or everywhere with "--global".`,
  );
  return 0;
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
  todos doctor             check everything that has to be true for this to work
  todos setup              link the CLI onto PATH and print the statusline snippet`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const cwd = process.cwd();

  switch (command ?? "board") {
    case "board": {
      const digest = digestFor(cwd);
      const { url } = await ensureUp();
      const target = digest ? `${url}/p/${digest.project.slug}` : url;
      openInBrowser(target);
      console.log(digest ? `${terminalDigest(digest)}\n\n${target}` : `No project for ${cwd}.\n\n${target}`);
      return;
    }
    case "pending": {
      const digest = digestFor(cwd);
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
      console.log(up ? `Up at ${boardOrigin()}` : "Stopped.");
      process.exitCode = up ? 0 : 1;
      return;
    }
    case "serve": {
      const { url, started } = await ensureUp();
      console.log(started ? `Started at ${url}` : `Already up at ${url}`);
      return;
    }
    case "stop":
      console.log(stop());
      return;
    case "url":
      console.log(boardOrigin());
      return;
    case "open": {
      const { url } = await ensureUp();
      const target = rest[0] ? new URL(rest[0], url).toString() : url;
      openInBrowser(target);
      console.log(target);
      return;
    }
    case "statusline":
      process.exitCode = statusline(rest, cwd);
      return;
    case "doctor":
      process.exitCode = await doctor(cwd);
      return;
    case "setup":
      process.exitCode = setup();
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
