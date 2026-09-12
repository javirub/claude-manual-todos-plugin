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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bunExecutable } from "@/lib/runtime";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [toolName, rawArgs] = process.argv.slice(2);

const child = Bun.spawn([bunExecutable(), "mcp/server.ts"], {
  cwd: ROOT,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "inherit",
});
const pending = new Map<number, (value: Record<string, any>) => void>();
let nextId = 0;
const timeout = setTimeout(() => {
  console.error("MCP smoke test timed out waiting for a protocol response.");
  child.kill();
  process.exit(1);
}, 15_000);

function receive(line: string): void {
  let message: Record<string, any>;
  try {
    message = JSON.parse(line);
  } catch {
    return; // not our frame
  }
  const resolvePending = message.id != null ? pending.get(message.id) : undefined;
  if (resolvePending) {
    pending.delete(message.id);
    resolvePending(message);
  }
}

// Bun's native pipe sink needs an explicit flush while keeping stdin open for
// the next request. Avoid depending on node:child_process's stream buffering.
void (async () => {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of child.stdout) {
    buffered += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffered.indexOf("\n")) !== -1) {
      receive(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
    }
  }
})().catch(error => {
  console.error(error);
  child.kill();
  process.exit(1);
});

function write(message: unknown): void {
  child.stdin.write(`${JSON.stringify(message)}\n`);
  child.stdin.flush();
}

function send(method: string, params: unknown): Promise<Record<string, any>> {
  const id = ++nextId;
  return new Promise((res) => {
    pending.set(id, res);
    write({ jsonrpc: "2.0", id, method, params });
  });
}

const init = await send("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "mcp-smoke", version: "1" },
});
if (init.error || !init.result?.serverInfo) {
  console.error(`initialize failed: ${JSON.stringify(init.error ?? init)}`);
  child.kill();
  process.exit(1);
}
write({ jsonrpc: "2.0", method: "notifications/initialized" });
console.log(`connected to ${init.result?.serverInfo?.name} ${init.result?.serverInfo?.version}`);

if (!toolName) {
  const listed = await send("tools/list", {});
  if (listed.error || !Array.isArray(listed.result?.tools)) {
    console.error(`tools/list failed: ${JSON.stringify(listed.error ?? listed)}`);
    child.kill();
    process.exit(1);
  }
  const tools = listed.result?.tools ?? [];
  console.log(`${tools.length} tools: ${tools.map((t: { name: string }) => t.name).join(", ")}`);
} else {
  const called = await send("tools/call", {
    name: toolName,
    arguments: rawArgs ? JSON.parse(rawArgs) : {},
  });
  if (called.error || called.result?.isError) {
    console.error(`error: ${JSON.stringify(called.error ?? called.result)}`);
    child.kill();
    process.exit(1);
  }
  console.log(called.result.content.map((c: { text?: string }) => c.text ?? "").join("\n"));
}

clearTimeout(timeout);
child.kill();
process.exit(0);
