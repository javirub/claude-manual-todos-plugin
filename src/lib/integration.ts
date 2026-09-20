import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { canonical, stateDir } from "./db/paths";
import { atomicWrite } from "./fs";
import { IS_WINDOWS, PLUGIN_ROOT, bunExecutable } from "./runtime";

const ROOT = PLUGIN_ROOT;
const MARKER = "Manual todos managed launcher";

export interface InstallationOptions {
  root: string;
  directory: string;
  binDirectory: string;
  bun: string;
  windows: boolean;
}

export function installationOptions(): InstallationOptions {
  return {
    root: ROOT,
    directory: join(stateDir(), "integration"),
    binDirectory: IS_WINDOWS
      ? join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "claude-tasks", "bin")
      : join(homedir(), ".local", "bin"),
    bun: bunExecutable(),
    windows: IS_WINDOWS,
  };
}

interface Registration {
  root: string;
  bun: string;
  version: string;
  environment: Record<string, string>;
}

function readRegistration(options: InstallationOptions): Registration | null {
  try {
    const value = JSON.parse(readFileSync(join(options.directory, "runtime.json"), "utf8"));
    if (typeof value.root !== "string" || typeof value.bun !== "string" || typeof value.version !== "string") return null;
    // A hand-edited file must not put `undefined` into the launcher's environment spread.
    const environment = value.environment && typeof value.environment === "object" && !Array.isArray(value.environment)
      ? value.environment : {};
    return { root: value.root, bun: value.bun, version: value.version, environment };
  } catch { return null; }
}

function owned(path: string): boolean {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      const target = resolve(dirname(path), readlinkSync(path));
      const manifest = JSON.parse(readFileSync(join(dirname(target), "../.claude-plugin/plugin.json"), "utf8"));
      return basename(target) === "todos.ts" && basename(dirname(target)) === "bin" && manifest.name === "todos";
    }
    return readFileSync(path, "utf8").split(/\r?\n/).some(line => line === `# ${MARKER}` || line === `rem ${MARKER}`);
  } catch { return false; }
}

function present(path: string): boolean {
  try { lstatSync(path); return true; } catch { return false; }
}

/** Two spellings of one directory. The `windows` flag is a parameter rather than
 * the platform because `installationOptions` already carries one and the tests
 * set it; the canonicalisation itself is shared with the path resolver. */
function samePath(left: string, right: string, windows: boolean): boolean {
  const a = canonical(left);
  const b = canonical(right);
  return windows ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function inspectInstallation(options = installationOptions()) {
  const cli = join(options.binDirectory, options.windows ? "todos.cmd" : "todos");
  const lookup = spawnSync(options.windows ? "where" : "which", ["todos"], { encoding: "utf8", timeout: 1000 });
  const resolved = lookup.status === 0 ? lookup.stdout.trim().split(/\r?\n/)[0] : null;
  const registration = readRegistration(options);
  return {
    cli,
    cliInstalled: present(cli) && owned(cli),
    // Two different problems. Something else already occupying the file we would
    // write is fatal: we never overwrite it. Something else merely winning the
    // PATH lookup is the user's to resolve, and must not block reinstalling ours.
    conflict: present(cli) && !owned(cli) ? cli : null,
    shadowedBy: resolved && !samePath(resolved, cli, options.windows) && !owned(resolved) ? resolved : null,
    onPath: (process.env.PATH || "").split(options.windows ? ";" : ":").includes(options.binDirectory),
    binDirectory: options.binDirectory,
    launcher: join(options.directory, "launcher.mjs"),
    bun: options.bun,
    registered: registration !== null,
    runtimeAvailable: !!registration && existsSync(join(registration.root, "bin/todos.ts")) && existsSync(registration.bun),
  };
}

function version(root: string): string {
  const manifest = JSON.parse(readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8"));
  if (manifest.name !== "todos") throw new Error("This directory is not the todos plugin.");
  return manifest.version;
}

function captureEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of ["CLAUDE_TASKS_DB", "CLAUDE_TASKS_PORT", "XDG_DATA_HOME", "XDG_STATE_HOME"]) {
    if (process.env[key]) environment[key] = process.env[key]!;
  }
  return environment;
}

/** `environment` is passed in on a refresh: it belongs to the session that opted in. */
function register(options: InstallationOptions, environment = captureEnvironment()): void {
  const registration: Registration = { root: options.root, bun: options.bun, version: version(options.root), environment };
  atomicWrite(join(options.directory, "launcher.mjs"), readFileSync(join(options.root, "bin/launcher.mjs"), "utf8"));
  atomicWrite(join(options.directory, "runtime.json"), JSON.stringify(registration, null, 2) + "\n");
}

/** Called only after the user chooses a CLI or statusline integration. */
export function installIntegration(cli: boolean, options = installationOptions()) {
  const before = inspectInstallation(options);
  if (cli && before.conflict) throw new Error(`Another command owns ${before.conflict}. Nothing was overwritten.`);
  if (cli) validateCliPaths(options, before.launcher);
  register(options);
  if (cli) writeCli(options, before.cli, before.launcher);
  return inspectInstallation(options);
}

function validateCliPaths(options: InstallationOptions, launcher: string): void {
  if (options.windows && /[\r\n"%!]/.test(options.bun + launcher)) {
    throw new Error("The launcher paths contain characters unsupported by cmd.exe; choose another installation directory.");
  }
}

function writeCli(options: InstallationOptions, cli: string, launcher: string): void {
  validateCliPaths(options, launcher);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const script = options.windows
    ? `@echo off\r\nrem ${MARKER}\r\n"${options.bun}" "${launcher}" %*\r\n`
    : `#!/bin/sh\n# ${MARKER}\nexec ${quote(options.bun)} ${quote(launcher)} "$@"\n`;
  atomicWrite(cli, script, 0o755);
}

/** -1, 0 or 1. A part that is missing or not a number counts as 0: a malformed
 * version never wins by accident, and never triggers a spurious rewrite. */
function compare(left: string, right: string): number {
  const parts = (value: string) => value.split(".").map(part => Number(part) || 0);
  const a = parts(left);
  const b = parts(right);
  for (let i = 0; i < Math.max(a.length, b.length, 3); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

/** Refresh opted-in integrations; an older concurrent session must not downgrade them. */
export function refreshIntegration(options = installationOptions()): void {
  const current = readRegistration(options);
  if (!current) return;
  const incoming = version(options.root);
  if (compare(incoming, current.version) < 0) return;
  // The version matters on its own: an install whose path never changes still
  // ships a new launcher, and comparing only paths would keep serving the old one.
  if (incoming === current.version && current.root === options.root && current.bun === options.bun) return;
  register(options, current.environment);
  const cli = join(options.binDirectory, options.windows ? "todos.cmd" : "todos");
  if (owned(cli)) writeCli(options, cli, join(options.directory, "launcher.mjs"));
}
