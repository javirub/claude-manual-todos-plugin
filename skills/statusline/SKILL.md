---
name: statusline
description: Add or adjust the todos segment in your status line, matching your existing style.
argument-hint: [style or adjustment]
disable-model-invocation: true
---

Read `${CLAUDE_PLUGIN_ROOT}/skills/statusline/references/configuration.md` and
follow it in the user's conversation language. `$ARGUMENTS` describes the desired
adjustment. Invoking this command authorizes adding/configuring the segment; do
not ask again unless a conflict, a scope change or an ambiguous request needs a
decision. Stay in the main conversation. Do not enable the terminal CLI or start
the board as a side effect.
