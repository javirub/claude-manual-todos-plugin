# claude-manual-todos-plugin

[![CI](https://github.com/javirub/claude-manual-todos-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/javirub/claude-manual-todos-plugin/actions/workflows/ci.yml)

The things only you can do, in one place, ordered by date and separated by project.

When Claude finishes a piece of work there is almost always something no
automation can reach: a form in App Store Connect, a secret to seed, a promotion
to trigger, a review to answer. This is a SQLite database for exactly that, an
MCP server so Claude can write to it from any repository, and a Next.js board to
work through it and tick things off.

## Layout

```
.claude-plugin/   plugin manifest and marketplace entry
.mcp.json         declares the "tasks" MCP server
messages/         en.json and es.json — the board's own words, in ICU
skills/           when to record a task, and how to write a step
commands/         /tasks and /pendings
hooks/            one line at session start with what is pending here
mcp/server.ts     launcher: checks dependencies, then hands over to main.ts
mcp/main.ts       21 MCP tools over the database
bin/tasks.ts      status | serve | stop | url | open
src/lib/db/       schema, migrations and queries — shared by the MCP and the app
src/lib/theme/    each project's palette, derived in OKLCH
src/app/          the board
scripts/          MCP smoke driver, and the Node-side database check
renovate.json     dependency updates, via the Renovate GitHub App
.github/          CI on Linux, macOS and Windows
```

**The MCP writes to SQLite directly and never calls the board.** Recording a task
must not fail because a web server is down; bringing the interface up is only for
looking. Both processes open the same file in WAL mode.

The database lives at `~/.local/share/claude-tasks/tasks.db` (`$CLAUDE_TASKS_DB`
moves it). Outside the repository on purpose: reinstalling the plugin or deleting
the checkout must not take your tasks with it.

**Nothing leaves your machine.** No account, no sync, no telemetry. The board
binds to `127.0.0.1` and nothing else, which is deliberate: it authenticates
nobody, and it holds the exact values and console links for your pending work —
on a shared network the default of binding every interface would hand all of that
to the room, editable.

## Requirements

| | |
|---|---|
| **Bun** | ≥ 1.2, on `PATH`. Developed on 1.4. It is the only hard requirement: the MCP server, the CLI, the session hook and the Next.js board all run on it. |
| **Operating system** | Linux, macOS and Windows. CI runs the whole suite on all three, including starting and stopping the board, because that is where they differ. |
| **Node.js** | Not needed to use the plugin. Only `scripts/db-portability.mjs` runs on it, and that wants ≥ 22.5 for `node:sqlite`. |
| **Network** | Once, at build time: `next/font` fetches the four typefaces and self-hosts them. Nothing is fetched at runtime — the board works offline, which matters when the reason you are looking at it is that something else is broken. |

The plugin is **not runnable on Node** as it stands: the source imports without
file extensions and leans on the `@/` path alias, neither of which Node resolves.
That is a deliberate limit rather than an oversight — what the `node:sqlite`
driver buys is narrower and more useful: **the database outlives the runtime**.
A `tasks.db` written by Bun opens in plain Node with no Bun installed, which CI
checks on every platform, so your tasks are never hostage to this choice.

### Environment

| | |
|---|---|
| `CLAUDE_TASKS_DB` | Where the database lives. Default: `~/.local/share/claude-tasks/tasks.db`, or `%LOCALAPPDATA%\claude-tasks\tasks.db` on Windows. |
| `CLAUDE_TASKS_PORT` | The board's port, read by `bun run tasks` and by the MCP. Default 4477. Running `bun run dev` or `bun run start` directly bypasses the CLI, so those take Next's own `PORT` instead. |
| `XDG_DATA_HOME`, `XDG_STATE_HOME` | Honoured where set, on every platform. |

## Install

```
/plugin marketplace add javirub/claude-manual-todos-plugin
/plugin install claude-manual-todos-plugin@claude-manual-todos
```

It installs at user level, so the tools are available in every project rather
than only in this one. Bun has to be on `PATH`; nothing else is needed. The
marketplace clones the repository without dependencies, so the MCP server runs
`bun install` for itself the first time it starts (`mcp/preflight.ts`).

The first `open_board` in a fresh checkout falls back to `next dev`, which
compiles on demand and takes a few seconds. Running `bun run build` once in the
plugin directory makes it start instantly from then on.

## Use

The normal path is that you do nothing: Claude records what is left for you when
it finishes something, and hands you the link. By hand:

```sh
bun run tasks serve     # brings the board up (http://127.0.0.1:4477)
bun run tasks status
bun run tasks stop
bun run tasks open /p/costia
```

In a session, `/tasks` opens the board and `/pendings` reports in the chat.

## Model

- A **project** can span several repositories (`project_paths`). That is what
  makes `costia/frontend`, `costia/backend` and `costia/docs-site` one project,
  and what answers "which project am I in?": the longest registered path that
  contains the working directory wins, so a repository claims its own
  subdirectories back from the superproject above it.
- A **task** can belong to several projects with a single shared state, and can
  be linked to another with `blocks` or `relates` — across projects too.
- A task's state is **derived**: it is done when every one of its steps is. There
  is no field that can lie.
- Every step remembers **who closed it**. The ones Claude resolved in code stay
  visible, marked as such, rather than disappearing: seeing what is already done
  is half the context for why the rest is still open.

## Per-project identity

Switching project changes the look of the whole interface, so you know where you
are without reading anything. A theme is six numbers in the database — hue,
chroma, how much the greys are tinted, mode, texture, typeface — and the entire
palette is derived from them in OKLCH.

**The lightness ramp is fixed per mode and is not exposed.** Text-on-background
contrast is guaranteed by construction, so an agent can invent the identity of a
new project without being able to make anything unreadable. When a project is
created, a hue within 25° of another is refused: two projects that look alike
defeat the purpose.

`test/theme.test.ts` sweeps the whole hue circle in both modes against WCAG AA.
It has already caught two real contrast failures, so keep it passing when you
touch those ramps.

## Language

Three audiences, and they do not get the same words.

**The repository speaks English**, always: this file, the skill, the commands, the
MCP tool descriptions, code comments and commit messages. So does the scaffolding
the MCP prints back to Claude — bucket headings, `why:`, `value:`, "done by agent"
— in `src/lib/format/text.ts`.

**The board speaks the user's language.** English and Spanish so far, through
[next-intl](https://next-intl.dev): catalogues in `messages/*.json` with ICU
plurals, the request config in `src/i18n/request.ts`, and a switch at the foot of
the project rail.

**Task content is written in the user's language too**, by the agent, and stored
as written. `where_am_i` prints the language on every call so Claude does not have
to guess, and `set_locale` changes it. Existing tasks are never retranslated: a
task recorded in Spanish stays in Spanish when the board is switched to English,
because it is a note someone wrote, not a label.

The locale lives in SQLite rather than in a cookie or the URL. It is not only a
display preference — the agent reads the same setting — and a per-browser cookie
would let the board and Claude disagree about it.

Two things keep the catalogues honest, so neither is done by hand:

- `global.d.ts` augments next-intl with `typeof messages/en.json`, which makes a
  wrong or missing key a **compile error** (`bun run typecheck`).
- `bun run lint:messages` runs [`@eloqnt/cli`](https://cli.eloqnt.dev), which finds
  missing translations, ICU arguments that disagree between locales, and messages
  nothing uses. It has already caught two dead keys.

To add a locale: add `messages/<code>.json`, extend `LOCALES` in
`src/lib/db/settings.ts` with its label, and run both of the above.

## Development

```sh
bun test              # schema, path containment, derived state, ordering, themes
bun run typecheck     # includes message keys, via the next-intl augmentation
bun run lint:messages # catalogue health: missing, inconsistent or orphan messages
bun run dev
```

Anything that touches paths, spawns a process or kills one deserves a look on
more than one platform. CI covers it, and the parts most likely to break are
`isWithin` in `src/lib/db/paths.ts` (separators and case folding) and the
serve/stop pair in `bin/tasks.ts` (process groups on Unix, `taskkill /T` on
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

## Licence

MIT. See [LICENSE](LICENSE).
