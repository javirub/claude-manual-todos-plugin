/**
 * The board's process lifecycle, extracted from the CLI that used to own it.
 *
 * Both the CLI and the MCP server have to be able to bring the board up, and until
 * now the MCP server did it by importing `bin/todos.ts` — which imports the status
 * line, `doctor` and the installer, and which in turn imports `mcp/preflight`. A
 * tool that returns a URL should not drag the whole terminal surface into the
 * server process, and nothing should have to reason about that import cycle.
 *
 * Starting a server is also the one thing in here that a hosted board would never
 * need, which is the other reason it lives apart from the URLs in ./permalink.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ensureDependencies } from "../../mcp/preflight";
import { boardPort, stateDir } from "@/lib/db/paths";
import { boardHome } from "@/lib/permalink";
import { IS_WINDOWS, PLUGIN_ROOT, bunExecutable } from "@/lib/runtime";

const PID_FILE = join(stateDir(), "board.pid");
const LOG_FILE = join(stateDir(), "board.log");

export async function isUp(timeoutMs = 500): Promise<boolean> {
  try {
    const response = await fetch(`${boardHome()}/api/health`, {
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
export function chooseScript(): "start" | "dev" {
  return isBuilt() ? "start" : "dev";
}

/** Whether the board will start immediately or compile on first request. */
export function isBuilt(): boolean {
  return existsSync(join(PLUGIN_ROOT, ".next", "BUILD_ID"));
}

export async function ensureUp(): Promise<{ url: string; started: boolean }> {
  if (await isUp()) return { url: boardHome(), started: false };

  // A checkout straight from the marketplace has no node_modules and no build.
  ensureDependencies();
  mkdirSync(stateDir(), { recursive: true });
  const log = openSync(LOG_FILE, "a");
  const script = chooseScript();

  const child = spawn(bunExecutable(), ["run", script], {
    cwd: PLUGIN_ROOT,
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
    if (await isUp(1000)) return { url: boardHome(), started: true };
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `The board did not answer on ${boardHome()} after starting it with "bun run ${script}". See ${LOG_FILE}.`,
  );
}

export function stopBoard(): string {
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
