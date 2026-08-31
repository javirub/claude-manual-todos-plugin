---
description: List what is still pending in the current project, right here, without opening a browser.
---

1. `where_am_i` with the current directory.
2. `list_tasks` with `state: "open"`, and `withSteps: true` if the user asks for
   detail.
3. Summarise in the chat, grouped by urgency: overdue first, then this week, then
   the rest. For each task, its progress (`2/5`) and what is blocking it.

If `$ARGUMENTS` names a project or an owner, filter by it.

Change nothing: this command only reads.
