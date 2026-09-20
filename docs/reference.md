# Technical reference

[Back to the quick start](../README.md)

## How it works

**The MCP writes to SQLite directly and never calls the board.** Recording a task
must not fail because a web server is down; bringing the interface up is only for
looking. Both processes open the same file in WAL mode.

The database lives at `~/.local/share/claude-tasks/tasks.db` (`$CLAUDE_TASKS_DB`
moves it). Outside the repository on purpose: reinstalling the plugin or deleting
the checkout must not take your tasks with it.

**There is no separate todos account, sync service or telemetry.** Task data is
stored locally; tools return task content to your Claude Code conversation. The board
binds to `127.0.0.1` and nothing else, which is deliberate: it authenticates
nobody, and it holds the exact values and console links for your pending work —
on a shared network the default of binding every interface would hand all of that
to the room, editable.

<details>
<summary><b>The model</b> — projects, tasks, steps, and why a task's state cannot lie</summary>

<br>

- A **project** can span several repositories. What a project is made of lives in
  `project_repos` — a remote, a branch and a place in the layout, all of which
  mean the same thing on every computer. Where those repositories are *checked
  out* lives in `project_paths`, and means nothing on any other machine. That
  split is what lets a project be rebuilt somewhere it has never been.
- "Which project am I in?" is answered from the checkouts: the longest registered
  path that contains the working directory wins, so a repository claims its own
  subdirectories back from the superproject above it. Paths are compared through
  their canonical form as well as the one you typed, so a checkout reached through
  a symlink still resolves.
- A **task** can belong to several projects with a single shared state, and can
  be linked to another with `blocks` or `relates` — across projects too.
- A task's state is **derived**: it is done when every one of its steps is. There
  is no field that can lie.
- Every step remembers **who closed it**. The ones Claude resolved in code stay
  visible, marked as such, rather than disappearing: seeing what is already done
  is half the context for why the rest is still open.

</details>

<details>
<summary><b>Moving to another computer</b> — repositories, bases and import</summary>

<br>

A project's paths describe *this* machine. Move to another one and they point at
directories that do not exist, with no record of what they used to hold. So two
more things are recorded alongside them:

- **`project_repos`** — one row per repository: a key that is the same everywhere
  (`frontend`), its remote, its branch, and where it sits relative to the others.
  `relative_path` is empty for a repository shared between projects, which no
  import can place under any one of them.
- **`project_bases`** — the directory a project's repositories sit under, per
  machine. Yours might be `~/Proyectos/costia` here and `/srv/costia` on a server.

`todos repos --scan` fills both in from checkouts you already have: it asks git
what each registered path is, takes the deepest directory containing all of them
as the base, and keeps what is left as the layout. Nothing to type.

`todos import <project> --into <dir>` rebuilds it elsewhere. It prints what it
would do and waits for a yes, because everything it does happens outside any
directory this plugin owns:

```text
todos import costia-training --into ~/Proyectos

  clone        frontend    ~/Proyectos/costia/frontend
  adopt        backend     ~/Proyectos/costia/backend
  skip         secrets     no remote recorded, so there is nothing to clone from

  Clone these? [y/N]
```

A destination that already holds the same repository is **adopted**, not cloned.
One that holds something else is reported and stepped around — the cost of
guessing wrong there is someone's uncommitted work. Re-running after a failure
resumes. With no terminal to ask, it refuses rather than assuming yes; `--yes`
is how a script says it meant it.

Machines identify themselves with a value generated once and kept in
`$XDG_STATE_HOME/claude-tasks/machine.json`. Not the hostname, which changes and
gets reused, and not a MAC address, which belongs to an interface rather than a
computer.

</details>

<details>
<summary><b>Per-project identity</b> — six numbers, and why an agent cannot make it unreadable</summary>

<br>

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

</details>

<details>
<summary><b>Language</b> — three audiences, and they do not get the same words</summary>

<br>

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

</details>

<details>
<summary><b>Requirements and environment</b></summary>

<br>

| | |
|---|---|
| **Bun** | ≥ 1.2, on `PATH`. Developed on 1.4. It is the only hard requirement: the MCP server, the CLI, the session hook and the board all run on it. |
| **Operating system** | Linux, macOS and Windows. CI runs the whole suite on all three, including starting and stopping the board, because that is where they differ. |
| **Node.js** | Not needed to use the plugin. Only `scripts/db-portability.mjs` runs on it, and that wants ≥ 22.5 for `node:sqlite`. |
| **Network** | Installation downloads the plugin and its dependencies. At build time, `next/font` fetches the four typefaces and self-hosts them. Nothing is fetched at runtime — the board works offline, which matters when the reason you are looking at it is that something else is broken. |

The plugin is **not runnable on Node** as it stands: the source imports without
file extensions and leans on the `@/` path alias, neither of which Node resolves.
That is a deliberate limit rather than an oversight — what the `node:sqlite`
driver buys is narrower and more useful: **the database outlives the runtime**.
A `tasks.db` written by Bun opens in plain Node with no Bun installed, which CI
checks on every platform, so your tasks are never hostage to this choice.

| | |
|---|---|
| `CLAUDE_TASKS_DB` | Where the database lives. Default: `~/.local/share/claude-tasks/tasks.db`, or `%LOCALAPPDATA%\claude-tasks\tasks.db` on Windows. |
| `CLAUDE_TASKS_PORT` | The board's port, read by `todos` and by the MCP. Default 4477. Running `bun run dev` or `bun run start` directly bypasses the CLI, so those take Next's own `PORT` instead. |
| `CLAUDE_TODOS_QUIET` | Set to anything to silence the session-start line. |
| `XDG_DATA_HOME`, `XDG_STATE_HOME` | Honoured where set, on every platform. |

</details>
