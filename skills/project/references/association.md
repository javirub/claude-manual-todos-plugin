# Resolve and associate a project

1. Call `where_am_i` with the absolute current directory and `list_projects` to
   understand existing paths. A project can span repositories; a repository can
   also belong to several projects. Never assume folder name equals project name.
2. If the association is direct and unambiguous, report the project and path.
   Stop unless the user requested a change. If several projects match, show them
   and ask which one the user means before any write or board selection.
3. If no direct association exists, inspect the repository name and a small
   relevant part of its README/package metadata to propose a project name and
   purpose. Do not scan secrets or conduct a full code review. Present existing
   plausible projects, create-new and skip using AskUserQuestion. With many
   projects, first choose existing/new/skip, then narrow the existing selection.
   An inferred association from a child directory is a suggestion to attach the
   current directory, not permission to do so silently.
4. For an existing project selected by the user, call `add_project_path` with its
   slug and this absolute path, only if missing. For a new project, confirm the
   proposed name (unless already supplied), then call `create_project` with the
   path and a brief summary. Choose an identity appropriate to the product using
   the existing theme schema; omitting hue selects a free one. Do not ask the user
   to fill in theme parameters and do not change another project's identity.
5. Call `where_am_i` again to verify and report the association. Mention
   `/todos:tasks` and `/todos:pendings`. Return the selected slug to the ongoing
   onboarding flow; this procedure itself does not start the board.

Do not remove old paths, archive projects, create example tasks, or merge similar
names. A moved checkout may be associated here; removing its old path requires a
specific request. If the user skips, return without writing. Use MCP tools for
all project writes, never raw SQL.
