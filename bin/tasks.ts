#!/usr/bin/env bun
/**
 * Board lifecycle. The MCP server calls into this so that "register a task" and
 * "look at the board" stay independent: writing never needs the server to be up,
 * and bringing it up is a single idempotent call.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureDependencies } from "../mcp/preflight";
import { boardOrigin, boardPort, stateDir } from "../src/lib/db/paths";
import { IS_WINDOWS, bunExecutable, openerCommand } from "../src/lib/runtime";

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

async function main(): Promise<void> {
  const [command = "status", ...rest] = process.argv.slice(2);

  switch (command) {
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
      const opener = openerCommand(target);
      spawn(opener.command, opener.args, { detached: true, stdio: "ignore" }).unref();
      console.log(target);
      return;
    }
    default:
      console.error("Commands: status | serve | stop | url | open [path]");
      process.exitCode = 2;
  }
}

if (import.meta.main) await main();
