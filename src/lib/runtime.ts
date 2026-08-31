import { platform } from "node:os";

export const IS_WINDOWS = platform() === "win32";

declare const Bun: unknown;

/**
 * How to invoke Bun from a child process.
 *
 * When we are already running under Bun, `process.execPath` is that exact
 * binary: it needs no PATH lookup, cannot pick up a different version, and side-
 * steps the usual Windows problem of `spawn` not resolving a bare command name.
 * Under Node we have to go looking for it.
 */
export function bunExecutable(): string {
  return typeof Bun !== "undefined" ? process.execPath : IS_WINDOWS ? "bun.exe" : "bun";
}

/** The platform's "open this in whatever handles it" command. */
export function openerCommand(target: string): { command: string; args: string[] } {
  if (IS_WINDOWS) {
    // The empty string is the window title `start` insists on eating first,
    // otherwise a quoted URL is taken as the title and nothing opens.
    return { command: "cmd", args: ["/c", "start", "", target] };
  }
  if (platform() === "darwin") return { command: "open", args: [target] };
  return { command: "xdg-open", args: [target] };
}
