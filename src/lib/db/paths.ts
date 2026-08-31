import { homedir, platform } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const isWindows = platform() === "win32";

/**
 * The database lives outside the repository on purpose: reinstalling the plugin
 * or deleting the checkout must not take the user's tasks with it.
 *
 * XDG on Linux and macOS; on Windows the same idea under LOCALAPPDATA, because
 * a `.local/share` in a user's profile is nobody's convention there.
 */
export function databasePath(): string {
  const override = process.env.CLAUDE_TASKS_DB;
  if (override) return override;
  return join(dataHome(), "claude-tasks", "tasks.db");
}

function dataHome(): string {
  if (process.env.XDG_DATA_HOME) return process.env.XDG_DATA_HOME;
  if (isWindows && process.env.LOCALAPPDATA) return process.env.LOCALAPPDATA;
  return join(homedir(), ".local", "share");
}

export function stateDir(): string {
  if (process.env.XDG_STATE_HOME) return join(process.env.XDG_STATE_HOME, "claude-tasks");
  if (isWindows && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, "claude-tasks");
  return join(homedir(), ".local", "state", "claude-tasks");
}

export function boardPort(): number {
  const raw = process.env.CLAUDE_TASKS_PORT;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 4477;
}

export function boardOrigin(): string {
  return `http://127.0.0.1:${boardPort()}`;
}

/**
 * Windows and macOS both hand out case-insensitive filesystems by default, so
 * `C:\Repos\Costia` and `c:\repos\costia` are the same directory and have to
 * compare equal. Linux is case-sensitive and must not fold.
 */
function fold(path: string): string {
  return isWindows || platform() === "darwin" ? path.toLowerCase() : path;
}

/**
 * Is `target` the same directory as `base`, or inside it?
 *
 * Via `relative` rather than a string prefix: a prefix test needs the platform's
 * separator spliced in by hand — `startsWith(base + "/")` matches nothing at all
 * on Windows — and it happily claims `/repos/costia-training` lives inside
 * `/repos/costia`, which is exactly the case this project has to get right.
 */
export function isWithin(base: string, target: string): boolean {
  const rel = relative(fold(resolve(base)), fold(resolve(target)));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
