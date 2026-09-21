---
name: onboarding
description: Set up the optional terminal CLI, task status line and local board in your language.
disable-model-invocation: true
---

# Welcome to Manual Tasks

Configure what the user chooses. Speak the language of this conversation, including
question labels and the closing summary. Treat `$ARGUMENTS` and prior answers as
preferences already provided. Stay in the main conversation: this is interactive.

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/onboarding/references/terminal.md` and run
   its read-only inspection. Read effective Claude settings and inspect the
   existing statusLine command without executing unfamiliar scripts yet. Call
   `where_am_i` with the absolute current directory, and check the board with
   `bun "${CLAUDE_PLUGIN_ROOT}/bin/todos.ts" status` (exit 1 means stopped).
   If Bun is unavailable, locate a working real binary as described in the
   terminal reference. If none exists, explain the prerequisite and stop setup.
2. Use **one AskUserQuestion call** for the three independent decisions, each with
   yes/skip choices and descriptions, adapted to existing configuration:
   - Enable `todos` in your terminal to query tasks and open the board?
   - Add pending tasks to your status line, keeping its existing style?
   - Open the task board in your browser now?
   Do not ask again about choices supplied in the request. A missing answer is
   not consent. If AskUserQuestion is unavailable, ask equivalent text questions.
   An installed component should offer keep/reconfigure instead of reinstalling.
   If the conversation's language is English or Spanish and differs from the
   stored board language, include a fourth question about changing it. Use
   `set_locale` only when accepted; other conversation languages remain welcome
   even though the board currently supports only English and Spanish.
3. If the directory is unassociated or resolves only through a child directory,
   read `${CLAUDE_PLUGIN_ROOT}/skills/project/references/association.md` and offer
   that flow, with a skip option. Resolve these dependent questions after the
   initial batch. If all integrations were skipped, do not force project setup.
4. For accepted terminal setup, follow the terminal reference. For accepted
   statusline setup, read and follow
   `${CLAUDE_PLUGIN_ROOT}/skills/statusline/references/configuration.md` directly;
   do not invoke another user-only skill or make the user run a second command.
   These choices are independent: the status line must work without CLI setup.
5. If the user chose to open the board, call `open_board` with `open: true` and
   the resolved project. Without an association, omit project and cwd to open
   the general board. If several projects match, ask which board to open.
   A stopped board is normal; reuse a running one. If opening a browser is not
   available, return the URL and report that limitation accurately.
6. Verify each accepted action. Continue with independent choices if one fails.
   Finish with what works, what was skipped or failed, the board link when
   requested, and only the relevant next commands. Do not create sample tasks.

Never install Bun, change shell profiles, edit a statusline or open a browser
merely because this skill loaded: perform only the choices the user accepted.
Normal tool permission prompts still apply. Keep the flow short; no second
confirmation for an already accepted action unless a new conflict changes scope.
