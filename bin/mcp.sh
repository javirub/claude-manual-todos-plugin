#!/usr/bin/env bash
# Starts the MCP server with whichever Bun this machine actually has.
#
# Claude Code spawns MCP servers from its own environment, not from your login
# shell. A Bun installed through mise, asdf, fnm or Volta lives behind a shim
# that only exists once that tool has been activated by a shell profile — so
# `"command": "bun"` resolves when you run it and not when Claude Code does, and
# the only symptom is CONNECTION_CLOSED with nothing in any log.
#
# Point .mcp.json at this instead when that happens:
#
#   { "command": "${CLAUDE_PLUGIN_ROOT}/bin/mcp.sh" }
#
# Unix only. On Windows, put the absolute path to bun.exe in "command".
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

find_bun() {
  # Whatever is already on PATH wins: if it resolves here, it is the one the
  # user means, shim or not.
  if command -v bun >/dev/null 2>&1; then command -v bun; return; fi

  # Then the version managers, newest-looking install first, then the plain
  # installer's own directory.
  for candidate in \
    "${BUN_INSTALL:-$HOME/.bun}/bin/bun" \
    "$HOME/.local/share/mise/shims/bun" \
    "$HOME/.asdf/shims/bun" \
    "$HOME/.volta/bin/bun" \
    "/usr/local/bin/bun" \
    "/opt/homebrew/bin/bun"
  do
    [ -x "$candidate" ] && { printf '%s\n' "$candidate"; return; }
  done

  # mise and asdf can both answer the question themselves, and will pick the
  # version this directory is pinned to rather than a global one.
  for manager in mise asdf; do
    if command -v "$manager" >/dev/null 2>&1; then
      resolved="$("$manager" which bun 2>/dev/null || true)"
      [ -n "$resolved" ] && [ -x "$resolved" ] && { printf '%s\n' "$resolved"; return; }
    fi
  done

  # Last resort: the newest mise install, whatever it is called.
  for candidate in "$HOME/.local/share/mise/installs/bun"/*/bin/bun; do
    [ -x "$candidate" ] && { printf '%s\n' "$candidate"; return; }
  done

  return 1
}

# stderr, always: stdout is the JSON-RPC stream and anything else on it corrupts
# the protocol before the client can report why.
if ! bun_bin="$(find_bun)"; then
  echo "todos: cannot find Bun." >&2
  echo "todos: install it from https://bun.sh, or put the absolute path to it in" >&2
  echo "todos: the plugin's .mcp.json as \"command\"." >&2
  exit 127
fi

exec "$bun_bin" "$here/../mcp/server.ts" "$@"
