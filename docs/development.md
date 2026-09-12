# Development

[Back to the quick start](../README.md)

```sh
bun test              # schema, path containment, derived state, ordering, themes, manifests
bun run typecheck     # includes message keys, via the next-intl augmentation
bun run lint:messages # catalogue health: missing, inconsistent or orphan messages
bun run dev
```

To load this checkout directly, without installing or changing user settings:

```sh
claude --plugin-dir .
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
```

Run `/reload-plugins` after changing skills in an interactive session, or start a
new test session. Exercise `/todos:onboarding`, `/todos:statusline` and
`/todos:project` in English and Spanish. Use an isolated Claude configuration
directory, temporary database and state directory for setup tests; never install
test launchers in your actual user PATH.

The new command skills are user-only. Their shared references are read directly
by onboarding, rather than invoking another user-only skill. `manual-tasks` stays
model-invocable and is hidden from the slash menu.

Anything that touches paths, spawns a process or kills one deserves a look on
more than one platform. CI covers it, and the parts most likely to break are
`isWithin` in `src/lib/db/paths.ts` (separators and case folding) and the
serve/stop pair in `bin/todos.ts` (process groups on Unix, `taskkill /T` on
Windows).

The MCP tools are the plugin's interface and nothing above exercises the
protocol itself, so there is a driver for that:

```sh
bun scripts/mcp-smoke.ts                                  # handshake + tool inventory
bun scripts/mcp-smoke.ts where_am_i '{"cwd":"/some/path"}'
```

Run it after touching `mcp/main.ts`, and on any Renovate PR that moves
`@modelcontextprotocol/server` or `zod`. Point `CLAUDE_TASKS_DB` at a scratch
file before calling anything that writes.

### The pictures

```sh
bun run shots                  # seed, build, capture, frame — into docs/media/
bun run shots -- --skip-build  # reuse .next
bun run shots -- --keep        # leave the demo board up to click around in
```

It seeds a throwaway database (`scripts/seed-demo.ts`, English, dates relative to
today) on its own port, so neither your tasks nor a board you have open are
touched. Every shot waits on an **anchor** — a string that only exists once the
screen has really rendered — because otherwise a photograph of a loading state is
indistinguishable from a green run. Regenerate them whenever the interface
changes; CI fails if the files the README points at are missing.

`docs/media/manual/` holds the pictures no run produces — today, the terminal
screenshot of the statusline. The screenshot script wipes everything else in
`docs/media/` and leaves that directory alone, so put any hand-made picture there.
CI checks both groups.

**Then look at the pictures.** The exit code says a screen rendered, not that it
rendered right.

## Layout

```
.claude-plugin/   plugin manifest and marketplace entry
.mcp.json         declares the "tasks" MCP server
messages/         en.json and es.json — the board's own words, in ICU
skills/           onboarding, statusline, project and automatic task recording
commands/         /todos:tasks and /todos:pendings
hooks/            one line at session start with what is pending here
bin/todos.ts      the CLI: board lifecycle, digest, statusline, setup and doctor
bin/launcher.mjs  stable launcher template, copied into the user state directory
src/lib/integration.ts  opt-in installation and runtime registration
bin/mcp.sh        finds Bun when a version manager has hidden it
mcp/server.ts     launcher: checks dependencies, then hands over to main.ts
mcp/main.ts       22 MCP tools over the database
src/lib/db/       schema, migrations and queries — shared by the MCP and the app
src/lib/digest.ts one answer to "what is waiting here", for the CLI, bar and hook
src/lib/theme/    each project's palette, derived in OKLCH
src/app/          the board
scripts/          the demo seed, the screenshot pipeline, the MCP smoke driver
docs/media/       the board captures; docs/media/manual/ the hand-made ones
renovate.json     dependency updates, via the Renovate GitHub App
.github/          CI on Linux, macOS and Windows
```
