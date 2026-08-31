/**
 * Installed from git, a plugin arrives as a bare checkout: the marketplace clones
 * the repository and nothing runs `bun install` for you. The MCP server would
 * then fail on its very first import, before it can say why.
 *
 * This module imports nothing but Node builtins, so it can run first and fix that.
 * Everything it prints goes to stderr — stdout is the JSON-RPC stream.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bunExecutable } from "../src/lib/runtime";

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A dependency that is imported at module scope, so its absence is fatal. */
const SENTINEL = join(PLUGIN_ROOT, "node_modules", "@modelcontextprotocol", "server", "package.json");

export function ensureDependencies(): void {
  if (existsSync(SENTINEL)) return;

  console.error("claude-manual-todos: dependencies missing, running bun install…");
  const result = spawnSync(bunExecutable(), ["install", "--frozen-lockfile"], {
    cwd: PLUGIN_ROOT,
    // Both streams to stderr: anything on stdout would corrupt the protocol.
    stdio: ["ignore", 2, 2],
  });

  if (result.error) {
    throw new Error(
      `claude-manual-todos: could not run bun install in ${PLUGIN_ROOT} (${result.error.message}). ` +
        "Bun has to be on PATH for this plugin to work.",
    );
  }
  if (result.status !== 0 || !existsSync(SENTINEL)) {
    throw new Error(
      `claude-manual-todos: bun install failed in ${PLUGIN_ROOT} (exit ${result.status}). ` +
        "Run it there by hand to see why.",
    );
  }
  console.error("claude-manual-todos: dependencies installed.");
}
