#!/usr/bin/env bun
/**
 * Drives the MCP server over stdio and prints what it answers.
 *
 * The tools are the interface of this plugin, and nothing else exercises the
 * protocol: `bun test` covers the query layer underneath and the board covers
 * the reading. Run this after touching mcp/server.ts, and on any Renovate PR
 * that moves @modelcontextprotocol/server or zod.
 *
 *   bun scripts/mcp-smoke.ts                       # handshake + tool inventory
 *   bun scripts/mcp-smoke.ts where_am_i '{}'       # call one tool
 *
 * It talks to the real database unless CLAUDE_TASKS_DB points somewhere else,
 * so pass a scratch file before calling anything that writes.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bunExecutable } from "../src/lib/runtime";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [toolName, rawArgs] = process.argv.slice(2);

const child = spawn(bunExecutable(), ["mcp/server.ts"], {
  cwd: ROOT,
  stdio: ["pipe", "pipe", "inherit"],
});
const pending = new Map<number, (value: Record<string, any>) => void>();
let nextId = 0;

createInterface({ input: child.stdout }).on("line", (line) => {
  let message: Record<string, any>;
  try {
    message = JSON.parse(line);
  } catch {
    return; // not our frame
  }
  const resolvePending = message.id != null ? pending.get(message.id) : undefined;
  if (resolvePending) resolvePending(message);
});

function send(method: string, params: unknown): Promise<Record<string, any>> {
  const id = ++nextId;
  return new Promise((res) => {
    pending.set(id, res);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

const init = await send("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "mcp-smoke", version: "1" },
});
child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
console.log(`connected to ${init.result?.serverInfo?.name} ${init.result?.serverInfo?.version}`);

if (!toolName) {
  const listed = await send("tools/list", {});
  const tools = listed.result?.tools ?? [];
  console.log(`${tools.length} tools: ${tools.map((t: { name: string }) => t.name).join(", ")}`);
} else {
  const called = await send("tools/call", {
    name: toolName,
    arguments: rawArgs ? JSON.parse(rawArgs) : {},
  });
  if (called.error) {
    console.error(`error: ${called.error.message}`);
    child.kill();
    process.exit(1);
  }
  console.log(called.result.content.map((c: { text?: string }) => c.text ?? "").join("\n"));
}

child.kill();
process.exit(0);
