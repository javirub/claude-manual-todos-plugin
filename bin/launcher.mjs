// Manual todos managed launcher. Copied outside the versioned plugin cache.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const compact = args[0] === "--claude";
const cwdIndex = args.indexOf("--cwd");
// What the CLI actually receives, so --cwd anywhere reads the same as --cwd last.
const actionArgs = args.filter((_, i) => i !== cwdIndex && (cwdIndex < 0 || i !== cwdIndex + 1));
const quiet = compact || (actionArgs[0] === "statusline" && !actionArgs.slice(1).some(a => ["on", "off", "default", "status"].includes(a)));

function segment(registration, argv) {
  return spawnSync(registration.bun, [registration.root + "/bin/todos.ts", ...argv], {
    env: { ...registration.environment, ...process.env },
    stdio: quiet ? ["ignore", "pipe", "ignore"] : "inherit",
    encoding: "utf8",
    ...(quiet ? { timeout: 1000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 } : {}),
  });
}

// Labels in a terminal must not become control sequences or additional lines.
const label = value => String(value ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, "");

// A bar renders on every keystroke: it says nothing and fails at nothing. Only
// the terminal command reports that the integration needs repairing.
function fail(error) {
  if (quiet) return;
  console.error(`todos: ${error.message}. Run /todos:onboarding to repair the terminal integration.`);
  process.exitCode = 1;
}

let input = {};
if (compact) {
  try { input = JSON.parse(readFileSync(0, "utf8")); } catch { /* incomplete input */ }
  if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
}
const parts = [];
if (compact && input.model?.display_name) parts.push(label(input.model.display_name));
const percentage = input.context_window?.used_percentage;
if (compact && typeof percentage === "number" && Number.isFinite(percentage)) parts.push(`ctx ${Math.round(percentage)}%`);

try {
  const registration = JSON.parse(readFileSync(new URL("runtime.json", import.meta.url), "utf8"));
  const cwd = input.workspace?.current_dir || input.cwd || process.cwd();
  const result = segment(registration, compact ? ["statusline", "--cwd", cwd] : args);
  if (quiet) {
    if (!result.error && result.status === 0 && result.stdout?.trim()) parts.push(result.stdout.trim());
  } else if (result.error) fail(result.error);
  else process.exitCode = result.status ?? 1;
} catch (error) {
  // An unregistered or unreadable runtime costs the bar its segment, nothing more.
  fail(error);
}

if (quiet && parts.length) process.stdout.write(parts.join(" · ") + "\n");
