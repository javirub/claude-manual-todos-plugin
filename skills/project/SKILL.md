---
name: project
description: Show this folder's project, create a project or associate another repository with an existing one.
argument-hint: [project name or request]
disable-model-invocation: true
---

Speak the user's conversation language. Read
`${CLAUDE_PLUGIN_ROOT}/skills/project/references/association.md` and follow it for
the absolute current directory, incorporating `$ARGUMENTS` and prior choices.
Stay in this conversation and use AskUserQuestion for unresolved choices.
