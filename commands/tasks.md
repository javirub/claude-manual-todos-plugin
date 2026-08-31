---
description: Open the task board for the current project, starting it if it is not running.
---

Bring the board up if it is not running and hand the user the link.

1. `where_am_i` with the current directory, to find out which project you are in.
2. `open_board` for that project (or for `$ARGUMENTS` if the user named another).
3. Return the link and, in a single sentence, the most urgent thing inside it:
   overdue before this week, and say what blocks what if any task is linked to
   another.

If the directory belongs to no project, do not invent one: say so and ask whether
they want it registered.
