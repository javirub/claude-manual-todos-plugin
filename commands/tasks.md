---
description: Open the task board for the current project, starting it if it is not running.
argument-hint: [project]
allowed-tools: Bash(bun:*), mcp__plugin_todos_tasks__where_am_i, mcp__plugin_todos_tasks__open_board, mcp__plugin_todos_tasks__list_tasks
---

The board right now:

!`bun "${CLAUDE_PLUGIN_ROOT}/bin/todos.ts" status || true`

Bring it up if that says it is stopped, and hand the user the link.

1. `where_am_i` with the current directory, to find out which project you are in.
2. `open_board` for that project — or for `$1` if the user named another — with
   `open: true`, because they asked to look at it.
3. Return the link and, in a single sentence, the most urgent thing inside it:
   overdue before this week, and say what blocks what if any task is linked to
   another.

If the directory belongs to no project, open the general board without passing a
project or cwd, and suggest `/todos:project` to create or associate one.

Nothing here writes. Do not create, edit or close anything, even if what you find
looks wrong — say what looks wrong instead.
