# Add tasks to the user's status line

## Inspect and prepare

Read `${CLAUDE_PLUGIN_ROOT}/skills/onboarding/references/terminal.md` for Bun
resolution. Inspect user settings (honor CLAUDE_CONFIG_DIR when set), project and
local settings and any supplied/managed configuration that overrides statusLine.
Read only the relevant settings and the script/command it references. Do not
execute unfamiliar commands before understanding them. Preserve all unrelated
settings, including statusLine padding, refresh and other options.

Default to the user settings. If a project override is effective, explain which
configuration would change and ask whether to adjust that override or the user
default. Do not edit managed policy. Preserve the original scope for adjustments.

Prepare the stable launcher, independently of CLI installation:

```sh
bun "${CLAUDE_PLUGIN_ROOT}/bin/todos.ts" setup --statusline --json
```

Use the returned absolute `bun` and `launcher` paths. Never put a versioned cache
path or literal `${CLAUDE_PLUGIN_ROOT}` in the user's statusLine command. Quote
arguments for the actual shell, including spaces and apostrophes. No new runtime
dependencies are necessary. Read `bin/launcher.mjs` if you need its exact interface.

## Integrate

- **No existing bar:** configure `statusLine.type: "command"` with the absolute
  Bun binary running the stable launcher with `--claude`. It reads Claude's JSON
  stdin and renders `Model · ctx 42% · ◆ Project · 3 open`. Missing model/context
  fields are omitted. Keep its plain, compact style unless asked otherwise.
- **User-owned script:** back it up outside the plugin cache before editing it.
  Add or update a block marked `Manual todos segment` — that wording is an anchor in
  the user's own file, not a product name, so it keeps the old spelling after the
  rename to Manual Tasks; changing it orphans the block already in their script.
  Use the script's existing
  language and conventions. Match its palette, separators, spacing and line
  placement. Preserve all existing information and ANSI resets. Do not replace
  the whole bar with the compact default.
- **Third-party command or managed script:** first look for a supported custom
  segment mechanism. Otherwise create a user-owned wrapper with its own backup
  and ownership marker. Forward the original JSON stdin unchanged to the existing
  command, preserve its output/ANSI/multiple lines, and insert the tasks segment
  at the appropriate place. Do not modify package-managed or plugin-cache files.
  If matching an opaque command's style requires a choice, ask rather than claiming
  to have inferred it. Treat any existing command string as shell code; use its
  shell semantics intentionally, not accidental string interpolation.

For custom integrations call the stable launcher with:

```text
<absolute bun> <absolute launcher.mjs> statusline --cwd <session directory>
```

Reuse the parent script's parsed `workspace.current_dir`, then `cwd`, then its
working directory. The segment reads no stdin; do not make it consume the JSON a
second time. Invoke via argument arrays where the language supports them. The
launcher limits segment execution to one second and suppresses failures. Only
add separators/backgrounds when output is nonempty. The segment is plain text;
the parent supplies any colors. Never reuse a task/project name as shell code.

On repeat runs identify the existing marker or stable launcher reference and
update it, without nesting wrappers or duplicating segments. Preserve backups
from the first installation. Do not silently replace subsequent user edits.

## Verify and hand off

1. Check syntax using the script's interpreter and parse the resulting settings.
2. Exercise the resulting command with representative Claude JSON, including a
   session directory different from the process cwd. Compare existing segments
   before/after and confirm they still receive their original stdin.
3. Call `where_am_i` and inspect `todos statusline status --cwd <directory>` using
   the plugin CLI directly if it is not installed. No project, no open tasks, or
   disabled settings legitimately produce an empty segment. Do not report those
   as installation failures. Offer `/todos:project` for an unassociated folder.
4. If a real segment is unavailable, preview with an isolated temporary database
   or a stubbed segment **in a temporary copy** of the script. Label it as sample
   data, never write sample tasks to the user's database or leave a fake segment
   in the installed script. Check empty output and a failing segment as well.
5. If validation fails, undo only this attempt's edits using the backup, preserving
   unrelated changes, and report the concrete issue. Do not claim visual matching
   was verified if you only checked text output.

Report what was integrated, the exact edited files and backup location, and any
limits on verification. Explain that no pending tasks means no tasks segment.
Hide/show is available through `todos statusline off|on [--global]` or the board
toggle; if the CLI is absent use the full Bun/plugin CLI command. Do not change
stored off preferences without asking. No model inference runs on each render.
