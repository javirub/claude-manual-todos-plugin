# Terminal integration

Use a working Bun executable and the actual `${CLAUDE_PLUGIN_ROOT}`. Do not assume
a marketplace checkout path. Resolve Bun with `command -v bun` (Unix) or
`Get-Command bun` (PowerShell), verify `--version` is at least 1.2, and run
`bun -e 'console.log(process.execPath)'` to obtain the real executable. When a shim
fails, try the version manager's `which bun` or the standard Bun installation.
Do not install or update the runtime without a separate user request.

Inspect without writing:

```sh
bun "${CLAUDE_PLUGIN_ROOT}/bin/todos.ts" setup --check --json
```

The result reports `cli`, `cliInstalled`, `conflict`, `shadowedBy`, `onPath`,
`binDirectory`, `launcher`, `bun`, `registered`, and `runtimeAvailable`. Also
inspect shell aliases/functions named `todos`; an external-process lookup cannot
see those.
Do not print complete environment dumps or unrelated Claude settings.

After the user accepts terminal setup, run:

```sh
bun "${CLAUDE_PLUGIN_ROOT}/bin/todos.ts" setup --json
```

This installs a managed launcher, not a server, and does not configure a status
line. `conflict` means an unrelated command already occupies the file we would
write: setup refuses, nothing is overwritten, and the user decides. `shadowedBy`
is a different matter — installation succeeds, but another `todos` wins the PATH
lookup. Report its exact location and that ours runs only once `binDirectory`
comes first; never remove or rename the other command.

If its directory is absent from PATH, enabling the CLI includes adding that
directory to the user's PATH. Inspect the actual shell and existing config first.
On bash/zsh, add one marked `# Manual todos PATH` block to the appropriate user
startup file, preserving its contents and existing equivalent entries. Use fish's
`fish_add_path` for fish. On Windows, append the directory once to the User PATH
using `[Environment]::SetEnvironmentVariable`, preserving every existing entry;
do not use `setx` or modify the machine PATH. Back up a profile before editing it.
For an unknown shell, provide the exact directory and ask how they want it added.

Verify the absolute installed command with `help`, then command resolution in a
fresh instance of the user's shell. Do not claim a current parent terminal's PATH
has changed: tell the user to open a new terminal if needed. `todos doctor` offers
additional diagnostics but also opens/initializes the database; it is not the
read-only preflight.

The runtime registration lives in the existing claude-tasks state directory.
Future SessionStart hooks refresh an already registered integration to the new
plugin path, even with CLAUDE_TODOS_QUIET set. No registration means no hook writes.
