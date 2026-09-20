# Security

## Reporting

Use [private vulnerability reporting](https://github.com/javirub/claude-manual-todos-plugin/security/advisories/new).
Not a public issue, and not a pull request — both publish the problem before there
is anything to upgrade to.

Expect an acknowledgement within a week. This is maintained by one person, so if
you hear nothing, assume it was missed rather than ignored and say so again.

## What is worth reporting

The plugin holds **the exact values and console links for someone's pending
work** — secrets to seed, buckets to create, consoles to log into — in SQLite on
their own machine. Anything that moves that data somewhere it was not meant to go
is worth reporting, including:

- The board serving to an interface other than `127.0.0.1`. It authenticates
  nobody, deliberately, and loopback is the whole of the protection.
- Task content reaching a log, a crash report, or any network request.
- Path resolution that returns another project's tasks for a directory.
- A tool that would execute what a task's content says, rather than showing it.

## What is not a vulnerability

- **The board has no authentication.** That is documented and intended: it binds
  to loopback and is a single-user tool. Binding it wider would be the bug.
- **`todos import` runs `git clone`.** It prints what it will do and waits for a
  yes.
- The MCP server writes to SQLite without a password. It is your own file.

## Versions

Fixes go to the latest release. There is no long-term support branch.
