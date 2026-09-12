#!/usr/bin/env bun
/**
 * One line of context at the start of a session: what is already waiting for the
 * user in this project, and the most urgent of it.
 *
 * Silent when there is nothing, when the directory belongs to no project, or
 * when CLAUDE_TODOS_QUIET is set — a hook that speaks up every time stops being
 * read, and the whole value of this one is that its line is always news.
 */
import { boardOrigin } from "@/lib/db/paths";
import { digestFor, hookLine } from "@/lib/digest";
import { refreshIntegration } from "@/lib/integration";

try { refreshIntegration(); } catch { /* Optional integration must not break a session. */ }

try {
  if (process.env.CLAUDE_TODOS_QUIET) process.exit(0);

  const input = await Bun.stdin.text().catch(() => "");
  const payload = input ? (JSON.parse(input) as { cwd?: string }) : {};
  const cwd = payload.cwd || process.cwd();

  const digest = digestFor(cwd);
  if (!digest || !digest.open.length) process.exit(0);

  // Only mention the board if it is already up. Starting it here would make
  // every session pay for a server nobody asked for.
  const up = await fetch(`${boardOrigin()}/api/health`, { signal: AbortSignal.timeout(300) })
    .then((r) => r.ok)
    .catch(() => false);

  console.log(hookLine(digest, up ? `${boardOrigin()}/p/${digest.project.slug}` : null));
} catch {
  // A hook that fails must never be the reason a session does not start.
  process.exit(0);
}
