# Manual setup and recovery

[Back to the quick start](../README.md)

The easiest route is `/todos:onboarding` inside Claude Code. Use this page for
manual installation or to understand what the assistant changes.

## Find Bun and the plugin

Use the actual installed plugin directory, as reported by Claude Code's plugin
manager. Marketplace plugins run from a versioned cache; a path copied from a
different installation may not exist on your machine.

In the examples below, replace `/path/to/bun` with your working Bun executable and
`/path/to/plugin` with that installed directory. To find the real executable when
you use a version manager:

```sh
bun -e 'console.log(process.execPath)'
```

This is more reliable than copying a shim from `which bun`. If the MCP server
cannot find Bun, make the real executable available to the environment that
launches Claude Code. Unix users can also use the bundled `bin/mcp.sh` launcher;
Windows users can configure the absolute `bun.exe` path. Changes inside a plugin
cache may be lost on update, so fixing the launching environment is preferable.

The plugin's MCP preflight installs missing dependencies as a fallback. Current
Claude Code versions can also install dependencies from the committed lockfile
when caching the plugin. Initial installation needs network access; font downloads
can also occur when building the board.

## Enable the terminal command

```sh
/path/to/bun /path/to/plugin/bin/todos.ts setup --check --json
/path/to/bun /path/to/plugin/bin/todos.ts setup --json
```

`--check` reports paths and conflicts without installing anything; the two flags
are exclusive, since one inspects and the other installs. Setup creates a launcher
in `~/.local/bin/todos` on Unix or `%LOCALAPPDATA%\claude-tasks\bin\todos.cmd` on
Windows. It refuses to replace an unrelated command at that path. A different
`todos` earlier on your PATH is reported instead (`shadowedBy`) and does not stop
the installation: ours runs once its directory comes first. Add the returned `binDirectory` to your user PATH if missing,
then open a new terminal and run `todos help`.

Setup does not start the board, edit shell profiles or configure Claude settings.
The onboarding assistant can handle the PATH edit after you choose CLI setup.

## Configure the status line manually

Prepare its runtime without installing the terminal command:

```sh
/path/to/bun /path/to/plugin/bin/todos.ts setup --statusline --json
```

The output includes `bun` and `launcher`. Use those absolute paths in your Claude
user settings (`~/.claude/settings.json`, or your custom Claude config directory):

```json
{
  "statusLine": {
    "type": "command",
    "command": "\"/absolute/path/to/bun\" \"/absolute/path/to/launcher.mjs\" --claude"
  }
}
```

Merge this field into the existing settings; do not replace the file. Use proper
shell quoting for your paths. On Windows, forward slashes in JSON paths can avoid
backslash escaping; the paths must still point at your real `bun.exe` and launcher.
`--claude` reads Claude's stdin JSON and prints the model, context percentage and
pending tasks. If a project setting overrides your user statusline, resolve that
scope first instead of editing a setting that will not take effect.

Already have a bar? Use `/todos:statusline` to adapt its style. The integration
should back up user scripts, preserve all existing settings and output, and avoid
editing scripts owned by another package. Its task-only call is:

```text
<bun> <launcher.mjs> statusline --cwd <session directory>
```

Pass `workspace.current_dir` from the JSON your existing script already parsed,
falling back to `cwd`. The segment consumes no stdin and prints plain text. Add a
separator or background only when it returns nonempty output. For example, inside
a Bash script where `session_dir` is already extracted:

```sh
todos_segment=$("/absolute/path/to/bun" "/absolute/path/to/launcher.mjs" statusline --cwd "$session_dir")
if [ -n "$todos_segment" ]; then printf ' %s' "$todos_segment"; fi
```

Place it inside your existing rendering logic before its final newline. If the
original bar is an external command, its wrapper must forward the original stdin
to that command and preserve multiline output and ANSI styles.

## Empty output and updates

The segment is hidden with no project, no open tasks, or an off preference.
`todos statusline status` reports the visibility preference and project association;
`todos pending` reports tasks. A preference of “shows” alone does not mean there
are tasks to display. Project overrides take precedence over the global default:

```sh
todos statusline off --global
todos statusline on
todos statusline default
```

The stable launcher limits a task rendering to one second and omits failures.
The compact bar retains model/context information even if the task runtime fails.

Launchers and `runtime.json` live in the existing state directory:
`$XDG_STATE_HOME/claude-tasks/integration`, normally
`~/.local/state/claude-tasks/integration`, or
`%LOCALAPPDATA%\claude-tasks\integration` on Windows. The registration records the
plugin path and real Bun path, plus relevant storage/port environment overrides.
The calling environment overrides those saved defaults.

An enabled plugin refreshes an existing registration on session start after an
update. Older concurrent sessions cannot downgrade it. Until a new session starts,
the launcher uses the previously registered copy; if that copy is gone, rerun
onboarding. Bun itself must remain executable to run the hook and launchers.

## Undo setup

To hide tasks, use the visibility settings above. To remove an integration entirely,
remove only the marked todos block from your statusline script, or restore the
previous command recorded in your setup backup. If you edited the file since the
backup, merge the change instead of restoring the whole file.

Remove the managed `todos` launcher and its marked PATH addition if you no longer
want the CLI. Once neither integration is used, the `integration` state subdirectory
can be removed too. Plugin uninstall does not automatically edit your personal
statusline or shell profile. Do not remove the tasks database as part of cleanup.

## Board diagnostics

`todos doctor` checks Bun, dependencies, the database and the board. Run it through
the full Bun/plugin path if the CLI is not installed. `todos serve` starts the
board without a browser; `todos status`, `todos url` and `todos stop` inspect or
stop it. The default port is 4477; set `CLAUDE_TASKS_PORT` in Claude's environment
to use another port. The first launch can compile on demand. For a prebuilt board,
run `bun run build` in the installed plugin directory.
