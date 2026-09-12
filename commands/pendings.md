---
description: List what is still pending in the current project, right here, without opening a browser.
argument-hint: [project or owner]
allowed-tools: mcp__plugin_todos_tasks__where_am_i, mcp__plugin_todos_tasks__list_tasks, mcp__plugin_todos_tasks__get_task
---

1. `where_am_i` with the current directory.
2. `list_tasks` with `state: "open"`, and `withSteps: true` if the user asks for
   detail.
3. Summarise in the chat, grouped by urgency: overdue first, then this week, then
   the rest. For each task, its progress (`2/5`) and what is blocking it.

If `$ARGUMENTS` names a project or an owner, filter by it.

If the directory belongs to no project, suggest `/todos:project` to create or
associate one. Do not create one from this read-only command.

Change nothing: this command only reads. If a task looks stale or wrong, say so
and let the user decide — do not fix it here.

Faster, and free: `!todos pending` prints the same list with no model turn at all.
