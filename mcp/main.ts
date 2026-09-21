/**
 * The MCP surface over the tasks database. Reached through ./server.ts, which
 * makes sure the dependencies imported below actually exist.
 *
 * It writes to SQLite directly and never talks to the Next.js app. Registering
 * a manual step the user has to take must not depend on a web server being up;
 * the board is for looking, not for recording.
 *
 * Tool descriptions are in English, like everything else the repository says.
 * The task content they end up writing goes in the user's language, which
 * where_am_i reports. See skills/manual-tasks/SKILL.md.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod";

import { getLocalState, getStore } from "@/lib/core";
import { ensureUp } from "@/lib/board-process";
import { projectUrl, taskUrl } from "@/lib/permalink";
import { applyScan, executeImport, planImport, scanProject } from "@/lib/import";
import { detectRepo, gitAvailable, normaliseRemote } from "@/lib/git";
import { importPlanText, importResultText, repoListText, scanText } from "@/lib/format/repos";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/db/settings";
import { HueTooCloseError } from "@/lib/db/projects";
import { PLUGIN_NAME, PLUGIN_VERSION } from "@/lib/manifest";
import type { Project } from "@/lib/core/types";
import { projectDetailText, projectLine, taskDetailText, taskListText } from "@/lib/format/text";

const store = getStore();
const state = getLocalState();

// Claims the path rows written before machines existed, and records that this
// computer is one. Cheap, idempotent, and it has to happen before anything reads
// a checkout — see the note in src/lib/machine.ts.
state.register();

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });

/**
 * Paths are checked against this machine every time a project is rendered, so a
 * checkout root that moved shows up the first time anyone looks instead of as
 * unexplained silence from the session hook.
 */
const notOnDisk = (path: string) => !existsSync(path);

/**
 * The single most useful thing to tell an agent that is about to write a task:
 * which language to write it in. It is repeated on every where_am_i so it cannot
 * be missed halfway through a long session.
 */
async function languageLine(): Promise<string> {
  const locale = await store.getLocale();
  return `Write task content in ${LOCALE_LABELS[locale]} (${locale}) — titles, summaries, step bodies, reasons and phase names.`;
}

async function requireProject(ref: string | undefined, cwd: string | undefined): Promise<Project> {
  if (ref) {
    const found = await store.getProject(ref);
    if (found) return found;
    const known = (await store.listProjects()).map((p) => p.slug).join(", ") || "none";
    throw new Error(`No project "${ref}". The ones that exist: ${known}.`);
  }
  const here = cwd ?? process.cwd();
  const resolved = state.resolve(here);
  if (resolved.length === 1) return ((await store.getProject(resolved[0]!.projectSlug)))!;
  if (resolved.length > 1) {
    // A shared repository. Picking one would decide, silently, which board the
    // task lands on — and the wrong one is invisible until someone goes looking
    // for a task that is not there.
    throw new Error(
      `${here} belongs to ${resolved.length} projects: ` +
        `${resolved.map((r) => r.projectSlug).join(", ")}. ` +
        `Name the one you mean with \`project\`, and use \`alsoProjects\` if the task really belongs to more than one.`,
    );
  }
  throw new Error(
    `The path ${here} belongs to no project. ` +
      `Call where_am_i to see the options, then either create the project with create_project ` +
      `or attach the path to an existing one with add_project_path before recording anything.`,
  );
}

const presentAt = (projectId: string) => {
  const paths = state.listPaths(projectId);
  return (repo: { id: string }) => paths.find((p) => p.repoId === repo.id)?.path ?? null;
};

const themeSchema = z.object({
  mode: z.enum(["dark", "light", "auto"]).optional()
    .describe("dark, light, or auto to follow the system."),
  hue: z.number().min(0).max(359.9).optional()
    .describe("OKLCH hue, 0-359. Must be 25° or more from every other project. Omit it and the widest free gap is chosen."),
  chroma: z.number().min(0.02).max(0.22).optional()
    .describe("Accent saturation: 0.04 muted, 0.13 normal, 0.19 intense."),
  neutralChroma: z.number().min(0).max(0.03).optional()
    .describe("How far the greys are tinted towards the hue. 0 = pure neutral, 0.02 = clearly tinted ground."),
  accent2Hue: z.number().min(0).max(359.9).nullable().optional(),
  motif: z.enum(["none", "grid", "dots", "lines", "glow", "noise"]).optional()
    .describe("Background texture of the interface."),
  fontHeading: z.enum(["geometric", "grotesque", "serif", "mono"]).optional(),
  radius: z.enum(["sharp", "soft", "round"]).optional(),
});

const stepSchema = z.object({
  title: z.string().describe("One imperative action someone can finish in a sitting. Use the language reported by where_am_i."),
  body: z.string().nullish().describe("Where it is in the UI and what to do, in markdown and in the user's language. Code fences render with a copy button."),
  why: z.string().nullish().describe("What happens if they skip it, when the consequence is not obvious. A manual step with no reason gets skipped or done wrong. Use the user's language."),
  value: z.string().nullish().describe("The exact value they will paste: an identifier, a URL, a bucket name. Renders with a copy button."),
  linkUrl: z.string().nullish().describe("Link to the console where it is done, not to the documentation."),
  linkLabel: z.string().nullish(),
  owner: z.string().nullish().describe("Who or where: apple, gitlab, cluster, infisical… Created on demand if it did not exist."),
  done: z.boolean().optional().describe("true if already resolved. A step you resolved in code is recorded as done, not omitted: seeing what is already closed is half the context for the rest."),
  doneBy: z.enum(["user", "agent"]).optional(),
});

const server = new McpServer({ name: PLUGIN_NAME, version: PLUGIN_VERSION });

/* ------------------------------------------------------------------ context */

server.registerTool(
  "where_am_i",
  {
    title: "Where am I",
    description:
      "Resolves a working directory to a project and summarises what is pending in it. " +
      "ALWAYS call this before recording anything: it is what stops you creating a duplicate " +
      "project, and what tells you which tasks already exist.",
    inputSchema: z.object({
      cwd: z.string().optional().describe("Working directory. Defaults to the server's own."),
    }),
  },
  async ({ cwd }) => {
    const where = cwd ?? process.cwd();
    const all = state.resolve(where);
    if (all.length > 1) {
      const blocks: string[] = [];
      for (const r of all) {
        const found = ((await store.getProject(r.projectSlug)))!;
        const open = await store.listTasks({ projectId: found.id, state: "open" });
        blocks.push(
          `${projectDetailText(found, state.listPaths(found.id), notOnDisk)}\n  here as: ${r.path.path}${r.path.role ? ` (${r.path.role})` : ""}\n` +
            `Open (${open.length}):\n${taskListText(open)}`,
        );
      }
      return text(
        `${where} belongs to ${all.length} projects — it is shared, so there is no single answer.\n` +
          `${await languageLine()}\n\n${blocks.join("\n\n")}` +
          `\n\nRecording anything here needs \`project\` naming which one, and \`alsoProjects\` when it belongs to several.`,
      );
    }
    const resolved = all[0] ?? null;
    if (!resolved) {
      const projects = await store.listProjects();
      return text(
        `${where} belongs to no project.\n${await languageLine()}\n\n` +
          (projects.length
            ? `Projects that already exist:\n${projects.map((p) => `  ${projectLine(p)}`).join("\n")}\n\n` +
              `If this path is another repository of one of them, attach it with add_project_path ` +
              `(one project spans several repos). If it is a new project, create it with create_project: ` +
              `you will have to give it its own identity, and the widest free hue right now is ${await store.suggestFreeHue()}°.`
            : `There are no projects yet. Create the first one with create_project. ` +
              `A free hue to start from: ${await store.suggestFreeHue()}°.`),
      );
    }

    const { path } = resolved;
    const project = (await store.getProject(resolved.projectSlug))!;
    const open = await store.listTasks({ projectId: project.id, state: "open" });
    const relations = await store.listProjectRelations(project.id);
    const lines = [
      projectDetailText(project, state.listPaths(project.id), notOnDisk),
      resolved.viaDescendant
        // Resolved by inference rather than registration. Said first because it
        // is fixable in one call, and because until someone fixes it the session
        // hook has to guess on every start.
        ? `\n${where} is NOT attached to this project — ${path.path} is, below it. ` +
          `Attach it with add_project_path so it resolves directly from here.`
        : `\nYou are in ${path.path}${path.role ? ` (${path.role})` : ""}.`,
      await languageLine(),
    ];
    if (relations.length) {
      lines.push(`Related to: ${relations.map((r) => `${r.project.name} (${r.kind})`).join(", ")}.`);
    }
    // A repository recorded but not checked out here is the difference between
    // "this project has three repos" and "this machine has one of them". Said
    // here because this is the tool that runs before anyone goes looking.
    const here = presentAt(project.id);
    const absent = (await store.listRepos(project.id)).filter((repo) => !here(repo));
    if (absent.length) {
      lines.push(
        `${absent.length} of this project's repositories are not on this machine ` +
          `(${absent.map((r) => r.key).join(", ")}). import_project clones them.`,
      );
    }
    lines.push(`\nOpen (${open.length}):\n${taskListText(open)}`);
    return text(lines.join("\n"));
  },
);

server.registerTool(
  "list_projects",
  {
    title: "List projects",
    description: "Every project with its paths, its owners, its theme and how many tasks it has.",
    inputSchema: z.object({ includeArchived: z.boolean().optional() }),
  },
  async ({ includeArchived }) => {
    const projects = await store.listProjects({ includeArchived: includeArchived ?? false });
    if (!projects.length) return text("There are no projects.");
    return text(projects.map((p) => projectDetailText(p, state.listPaths(p.id), notOnDisk)).join("\n\n"));
  },
);

server.registerTool(
  "create_project",
  {
    title: "Create project",
    description:
      "Registers a project and its visual identity. A project can span several repositories: pass them " +
      "all in `paths`. The identity is invented HERE and only here, when a project that did not exist " +
      "is created during project setup or needs tasks recorded; pick a hue that matches the product and sits 25° or more from " +
      "every other project, or leave it out to get the widest free gap.",
    inputSchema: z.object({
      name: z.string(),
      summary: z.string().nullish(),
      paths: z
        .array(
          z.object({
            path: z.string(),
            label: z.string().nullish(),
            role: z.string().nullish().describe("frontend, backend, docs, cluster… Shown in the board's rail; use the user's language."),
          }),
        )
        .optional(),
      owners: z.array(z.object({ slug: z.string(), label: z.string().optional() })).optional(),
      theme: themeSchema.optional(),
    }),
  },
  async (input) => {
    try {
      const project = await store.createProject({
        name: input.name,
        summary: input.summary,
        paths: input.paths,
        owners: input.owners,
        theme: input.theme,
      });
      return text(`Created.\n\n${projectDetailText(project, state.listPaths(project.id))}`);
    } catch (error) {
      if (error instanceof HueTooCloseError) return text(error.message);
      throw error;
    }
  },
);

server.registerTool(
  "update_project",
  {
    title: "Update project",
    description: "Changes a project's name or summary, or archives it.",
    inputSchema: z.object({
      project: z.string(),
      name: z.string().optional(),
      summary: z.string().nullish(),
      archived: z.boolean().optional(),
      owners: z.array(z.object({ slug: z.string(), label: z.string().optional() })).optional(),
    }),
  },
  async ({ project, owners, ...patch }) => {
    const found = await requireProject(project, undefined);
    for (const owner of owners ?? []) await store.upsertOwner(found.id, owner);
    const updated = await store.updateProject(found.id, patch);
    return text(projectDetailText(updated, state.listPaths(updated.id)));
  },
);

server.registerTool(
  "add_project_path",
  {
    title: "Attach a path to a project",
    description:
      "Binds a directory to a project. This is what makes several repositories one project, and what " +
      "lets where_am_i resolve from any of them.",
    inputSchema: z.object({
      project: z.string(),
      path: z.string().describe(
        "Absolute. A relative path is resolved against this server's working directory, which is not " +
          "necessarily the one you are reasoning about, and the mistake is silent.",
      ),
      role: z.string().nullish(),
      label: z.string().nullish(),
    }),
  },
  async ({ project, path, role, label }) => {
    const found = await requireProject(project, undefined);
    state.addPath(found.id, { path, role, label });
    return text(projectDetailText((await store.getProject(found.id))!, state.listPaths(found.id), notOnDisk));
  },
);

server.registerTool(
  "remove_project_path",
  {
    title: "Detach a path from a project",
    description:
      "Removes one directory from a project. For a path that is no longer where the work is — a checkout " +
      "root that moved, a repository that was split out. Attaching the new one does not remove the old, " +
      "and a project whose paths all point somewhere that does not exist resolves to nothing.",
    inputSchema: z.object({
      project: z.string(),
      path: z.string().describe("Absolute, exactly as list_projects prints it."),
    }),
  },
  async ({ project, path }) => {
    const found = await requireProject(project, undefined);
    if (!state.removePath(found.id, path)) {
      return text(
        `${path} is not one of ${found.name}'s paths. They are:\n` +
          `${found.paths.map((p) => `  ${p.path}`).join("\n")}`,
      );
    }
    return text(projectDetailText((await store.getProject(found.id))!, state.listPaths(found.id), notOnDisk));
  },
);

server.registerTool(
  "link_projects",
  {
    title: "Relate two projects",
    description: "Records that two projects touch each other, and where.",
    inputSchema: z.object({
      from: z.string(),
      to: z.string(),
      kind: z.enum(["relates", "depends_on", "shares_infra"]).optional(),
      note: z.string().nullish(),
    }),
  },
  async ({ from, to, kind, note }) => {
    const a = await requireProject(from, undefined);
    const b = await requireProject(to, undefined);
    await store.linkProjects(a.id, b.id, kind ?? "relates", note);
    return text(`${a.name} ↔ ${b.name} (${kind ?? "relates"}).`);
  },
);

server.registerTool(
  "set_project_theme",
  {
    title: "Change a project's identity",
    description:
      "Adjusts a project's visual identity. The lightness ramp is fixed, so no value here can make " +
      "text unreadable: only hue, saturation, texture and typeface change.",
    inputSchema: z.object({ project: z.string(), theme: themeSchema }),
  },
  async ({ project, theme }) => {
    const found = await requireProject(project, undefined);
    try {
      const themed = await store.setProjectTheme(found.id, theme);
      return text(projectDetailText(themed, state.listPaths(themed.id)));
    } catch (error) {
      if (error instanceof HueTooCloseError) return text(error.message);
      throw error;
    }
  },
);

server.registerTool(
  "set_locale",
  {
    title: "Set the user's language",
    description:
      "Changes the language of the board and, more importantly, the language new task content is " +
      "written in. Only call this when the user asks: it is their preference, not yours. " +
      `Available: ${LOCALES.join(", ")}.`,
    inputSchema: z.object({ locale: z.enum(LOCALES) }),
  },
  async ({ locale }) => {
    await store.setLocale(locale as Locale);
    return text(`Language set to ${LOCALE_LABELS[locale as Locale]} (${locale}). ${await languageLine()}`);
  },
);

/* --------------------------------------------------------------------- read */

server.registerTool(
  "list_tasks",
  {
    title: "List tasks",
    description:
      "A project's tasks, grouped by date. CALL THIS BEFORE CREATING ANYTHING: if the task already " +
      "exists, the right move is almost always to do nothing, or to add the missing steps with " +
      "add_steps — not to create a second one.",
    inputSchema: z.object({
      project: z.string().optional().describe("Project slug. Omit it and the project is resolved from cwd."),
      cwd: z.string().optional(),
      state: z.enum(["open", "done", "archived", "cancelled", "all"]).optional().describe("Defaults to everything except archived."),
      owner: z.string().optional(),
      dueBefore: z.string().optional().describe("YYYY-MM-DD."),
      query: z.string().optional().describe("Searches titles, summaries and step bodies."),
      allProjects: z.boolean().optional(),
      withSteps: z.boolean().optional().describe("Return each task's steps too, so you can compare them against what you were about to write."),
    }),
  },
  async ({ project, cwd, state, owner, dueBefore, query, allProjects, withSteps }) => {
    const scoped = allProjects ? undefined : await requireProject(project, cwd);
    const tasks = await store.listTasks({
      projectId: scoped?.id,
      state,
      ownerSlug: owner,
      dueBefore,
      query,
    });
    const header = `${scoped ? scoped.name : "All projects"} — ${tasks.length} task(s)`;
    if (!withSteps) return text(`${header}\n\n${taskListText(tasks, { showProject: !scoped })}`);
    const full = await Promise.all(tasks.map((t) => store.getTask(t.id)));
    const details = full.map((t) => taskDetailText(t!)).join("\n\n———\n\n");
    return text(`${header}\n\n${details || "There are none."}`);
  },
);

server.registerTool(
  "get_task",
  {
    title: "Get a task",
    description: "One task in full: phases, steps with their ids, who closed each one, and what it links to.",
    inputSchema: z.object({ task: z.string().describe("Task slug or id.") }),
  },
  async ({ task }) => {
    const found = await store.getTask(task);
    if (!found) return text(`No task "${task}".`);
    return text(taskDetailText(found));
  },
);

/* -------------------------------------------------------------------- write */

server.registerTool(
  "create_task",
  {
    title: "Record a manual task",
    description:
      "Creates a task only the user can do. Only after checking list_tasks and confirming it does not " +
      "already exist. If you could have automated it, automate it — do not record it. Use `phases` " +
      "when the order is genuinely mandatory and loose `steps` when it is not: inventing a sequence " +
      "that does not exist is worse than having no phases. Use the language reported by where_am_i.",
    inputSchema: z.object({
      project: z.string().optional(),
      cwd: z.string().optional(),
      alsoProjects: z.array(z.string()).optional().describe("Other projects this same task also belongs to."),
      title: z.string(),
      summary: z.string().nullish().describe("A sentence or two on why the task exists and what it unblocks. Use the user's language."),
      dueAt: z.string().nullish().describe("YYYY-MM-DD, only when there is a real date. Do not invent deadlines: they empty the overdue bucket of meaning."),
      phases: z.array(z.object({ name: z.string(), note: z.string().nullish(), steps: z.array(stepSchema) })).optional(),
      steps: z.array(stepSchema).optional(),
      sourcePath: z.string().nullish(),
    }),
  },
  async ({ project, cwd, alsoProjects, ...input }) => {
    const scoped = await requireProject(project, cwd);
    const also = await Promise.all((alsoProjects ?? []).map(async (slug) => (await requireProject(slug, undefined)).id));
    const created = await store.createTask({
      ...input,
      projectId: scoped.id,
      alsoProjectIds: also,
      sourcePath: input.sourcePath ?? cwd ?? null,
    });
    return text(`Recorded in ${scoped.name}.\n\n${taskDetailText(created)}\n\n${taskUrl(created.slug)}`);
  },
);

server.registerTool(
  "update_task",
  {
    title: "Update a task",
    description:
      "Changes title, summary, date or project membership; archives or cancels. Archiving is for work " +
      "that no longer applies; completing is for work that is done, and that happens by closing steps.",
    inputSchema: z.object({
      task: z.string(),
      title: z.string().optional(),
      summary: z.string().nullish(),
      dueAt: z.string().nullish(),
      archived: z.boolean().optional(),
      cancelled: z.boolean().optional(),
      alsoProjects: z.array(z.string()).optional(),
    }),
  },
  async ({ task, alsoProjects, ...patch }) => {
    const found = await store.getTask(task);
    if (!found) return text(`No task "${task}".`);
    const also = alsoProjects
      ? await Promise.all(alsoProjects.map(async (slug) => (await requireProject(slug, undefined)).id))
      : undefined;
    return text(taskDetailText(await store.updateTask(found.id, { ...patch, alsoProjectIds: also })));
  },
);

server.registerTool(
  "add_steps",
  {
    title: "Add steps to a task",
    description:
      "Adds only the missing steps to an existing task. This is the right answer when the task is " +
      "already recorded but the work has grown: a second task with the same title is exactly what " +
      "this avoids.",
    inputSchema: z.object({
      task: z.string(),
      phase: z.string().nullish().describe("Phase name, in the user's language. Created at the end if it does not exist."),
      steps: z.array(stepSchema),
    }),
  },
  async ({ task, phase, steps }) => {
    const found = await store.getTask(task);
    if (!found) return text(`No task "${task}".`);
    return text(taskDetailText(await store.addSteps(found.id, steps, phase)));
  },
);

server.registerTool(
  "update_step",
  {
    title: "Update a step",
    description:
      "Corrects a step's text. A step describing a state of the world that has passed is worse than no " +
      "step at all: when something gets automated or stops being necessary, edit it or delete it.",
    inputSchema: z.object({
      stepId: z.union([z.string(), z.number()]),
      title: z.string().optional(),
      body: z.string().nullish(),
      why: z.string().nullish(),
      value: z.string().nullish(),
      linkUrl: z.string().nullish(),
      linkLabel: z.string().nullish(),
      owner: z.string().nullish(),
    }),
  },
  async ({ stepId, ...patch }) => {
    return text(taskDetailText(await store.updateStep(String(stepId), patch)));
  },
);

server.registerTool(
  "complete_steps",
  {
    title: "Mark steps done",
    description:
      "Closes steps by id. Use by='agent' for what you resolved in code: the board shows it as such, " +
      "which is how the user understands why the rest is still open. The task becomes complete on its " +
      "own once no step is left open.",
    inputSchema: z.object({
      stepIds: z.array(z.union([z.string(), z.number()])),
      by: z.enum(["user", "agent"]).optional(),
    }),
  },
  async ({ stepIds, by }) => {
    const taskIds = await store.setStepsDone(stepIds.map(String), true, by ?? "agent");
    if (!taskIds.length) return text("None of those steps exist.");
    const affected = await Promise.all(taskIds.map((id) => store.getTask(id)));
    return text(affected.map((t) => taskDetailText(t!)).join("\n\n———\n\n"));
  },
);

server.registerTool(
  "reopen_steps",
  {
    title: "Reopen steps",
    description: "Puts steps back to pending.",
    inputSchema: z.object({ stepIds: z.array(z.union([z.string(), z.number()])) }),
  },
  async ({ stepIds }) => {
    const taskIds = await store.setStepsDone(stepIds.map(String), false, "agent");
    if (!taskIds.length) return text("None of those steps exist.");
    const affected = await Promise.all(taskIds.map((id) => store.getTask(id)));
    return text(affected.map((t) => taskDetailText(t!)).join("\n\n———\n\n"));
  },
);

server.registerTool(
  "complete_task",
  {
    title: "Complete a whole task",
    description: "Closes every step of a task at once.",
    inputSchema: z.object({ task: z.string(), by: z.enum(["user", "agent"]).optional() }),
  },
  async ({ task, by }) => {
    const found = await store.getTask(task);
    if (!found) return text(`No task "${task}".`);
    return text(taskDetailText(await store.setTaskDone(found.id, true, by ?? "agent")));
  },
);

server.registerTool(
  "delete_step",
  {
    title: "Delete a step",
    description: "For a step that stopped making sense. If it merely changed, edit it with update_step.",
    inputSchema: z.object({ stepId: z.union([z.string(), z.number()]) }),
  },
  async ({ stepId }) => {
    return text(taskDetailText(await store.deleteStep(String(stepId))));
  },
);

server.registerTool(
  "delete_task",
  {
    title: "Delete a task",
    description:
      "Deletes a task and its steps for good. For work that no longer applies but did happen, " +
      "update_task with archived=true keeps the record.",
    inputSchema: z.object({ task: z.string() }),
  },
  async ({ task }) => {
    const found = await store.getTask(task);
    if (!found) return text(`No task "${task}".`);
    await store.deleteTask(found.id);
    return text(`Deleted "${found.title}".`);
  },
);

server.registerTool(
  "link_tasks",
  {
    title: "Link two tasks",
    description:
      "kind='blocks' when the first cannot be done until the second is; 'relates' when they merely " +
      "belong together. Works across different projects.",
    inputSchema: z.object({
      from: z.string(),
      to: z.string(),
      kind: z.enum(["blocks", "relates"]).optional(),
    }),
  },
  async ({ from, to, kind }) => {
    const a = await store.getTask(from);
    const b = await store.getTask(to);
    if (!a || !b) return text(`Cannot find ${!a ? from : to}.`);
    await store.linkTasks(a.id, b.id, kind ?? "relates");
    return text(taskDetailText((await store.getTask(a.id))!));
  },
);

/* --------------------------------------------------------------- checkouts */

/** Where this project lives here, falling back to the parent of its first path. */
function baseFor(project: Project, explicit?: string): string {
  if (explicit) return resolve(explicit);
  const recorded = state.projectBase(project.id);
  if (recorded) return recorded;
  throw new Error(
    `No base directory for ${project.slug} on this machine. ` +
      `Pass \`into\`, or set one with set_project_base.`,
  );
}

server.registerTool(
  "list_repos",
  {
    title: "List a project's repositories",
    description:
      "The repositories a project is made of, their remotes, and whether each one is checked out on " +
      "this machine. Use it before import_project, and whenever a path turns out not to exist here.",
    inputSchema: z.object({
      project: z.string().optional(),
      cwd: z.string().optional(),
    }),
  },
  async ({ project, cwd }) => {
    const scoped = await requireProject(project, cwd);
    return text(`${scoped.name}\n${repoListText(await store.listRepos(scoped.id), presentAt(scoped.id))}`);
  },
);

server.registerTool(
  "set_project_repo",
  {
    title: "Record a repository",
    description:
      "Registers one repository of a project: its remote, its branch, and where it sits relative to " +
      "the others. Give `path` and the remote and branch are read from the checkout there. The key is " +
      "the name this repository has on every machine, so keep it short and stable.",
    inputSchema: z.object({
      project: z.string().optional(),
      cwd: z.string().optional(),
      key: z.string().describe("Short stable name: frontend, backend, infra."),
      path: z.string().optional().describe("A checkout to read the remote and branch from."),
      remoteUrl: z.string().nullish(),
      defaultBranch: z.string().nullish(),
      relativePath: z.string().nullish()
        .describe("Where it goes under the project's base directory. Leave empty for a repository shared with other projects, which no import can place."),
      label: z.string().nullish(),
      role: z.string().nullish(),
    }),
  },
  async ({ project, cwd, key, path, remoteUrl, defaultBranch, relativePath, label, role }) => {
    const scoped = await requireProject(project, cwd);
    let detectedRemote = remoteUrl ?? null;
    let detectedBranch = defaultBranch ?? null;
    let toplevel: string | null = null;

    if (path) {
      const found = detectRepo(path);
      if (!found) throw new Error(`${resolve(path)} is not inside a git checkout.`);
      toplevel = found.toplevel;
      detectedRemote = detectedRemote ?? found.remoteUrl;
      detectedBranch = detectedBranch ?? found.branch;
    }

    const id = await store.upsertRepo(scoped.id, {
      key,
      remoteUrl: detectedRemote,
      defaultBranch: detectedBranch,
      relativePath: relativePath ?? null,
      label: label ?? null,
      role: role ?? null,
    });
    if (toplevel) state.addPath(scoped.id, { path: toplevel, repoId: id, label, role });

    return text(
      `Recorded ${key} for ${scoped.name}.\n` +
        `${repoListText(await store.listRepos(scoped.id), presentAt(scoped.id))}`,
    );
  },
);

server.registerTool(
  "remove_project_repo",
  {
    title: "Forget a repository",
    description:
      "Removes a repository from a project's description. The checkout on disk is left exactly where " +
      "it is; only the record that the project is made of it goes away.",
    inputSchema: z.object({
      project: z.string().optional(),
      cwd: z.string().optional(),
      key: z.string(),
    }),
  },
  async ({ project, cwd, key }) => {
    const scoped = await requireProject(project, cwd);
    const removed = await store.removeRepo(scoped.id, key);
    return text(
      removed
        ? `Removed ${key} from ${scoped.name}. Its checkout is untouched.`
        : `${scoped.name} has no repository called ${key}.`,
    );
  },
);

server.registerTool(
  "set_project_base",
  {
    title: "Set where a project lives here",
    description:
      "The directory this project's repositories sit under on this machine. It is per machine: setting " +
      "it here says nothing about where the project lives anywhere else.",
    inputSchema: z.object({
      project: z.string().optional(),
      cwd: z.string().optional(),
      path: z.string().describe("A directory, such as ~/Proyectos/costia."),
    }),
  },
  async ({ project, cwd, path }) => {
    const scoped = await requireProject(project, cwd);
    const base = state.setProjectBase(scoped.id, path);
    return text(`${scoped.name} lives under ${base} on this machine.`);
  },
);

server.registerTool(
  "adopt_paths",
  {
    title: "Describe a project from its checkouts",
    description:
      "Reads every registered path of a project, asks git what repository it is, and records the answers " +
      "as the project's repositories — remotes, branches and layout. This is what makes a project " +
      "importable onto another machine, and it needs nothing from the user.",
    inputSchema: z.object({
      project: z.string().optional(),
      cwd: z.string().optional(),
      apply: z.boolean().optional()
        .describe("false reports what it found and writes nothing. Defaults to true."),
    }),
  },
  async ({ project, cwd, apply }) => {
    if (!gitAvailable()) throw new Error("git is not on PATH, so there is nothing to ask about these checkouts.");
    const scoped = await requireProject(project, cwd);
    const scan = scanProject(state, scoped);
    const report = scanText(scan, scoped.name);
    if (apply === false) return text(`${report}\n\nNothing written. Call again without \`apply: false\` to record it.`);
    const written = await applyScan(store, state, scoped, scan);
    return text(`${report}\n\nRecorded ${written} repositor${written === 1 ? "y" : "ies"}.`);
  },
);

server.registerTool(
  "import_project",
  {
    title: "Clone a project's repositories here",
    description:
      "Recreates a project's checkouts under a directory you choose, cloning what is missing and adopting " +
      "what is already there. It returns a plan and writes nothing until you call it again with " +
      "confirm:true — show the user the plan and let them agree to it, because this clones into " +
      "directories outside anything this plugin owns.",
    inputSchema: z.object({
      project: z.string().optional(),
      cwd: z.string().optional(),
      into: z.string().optional()
        .describe("The base directory. Defaults to the one already recorded for this machine."),
      only: z.array(z.string()).optional().describe("Repository keys, when you want a subset."),
      confirm: z.boolean().optional().describe("true carries the plan out. Off by default."),
    }),
  },
  async ({ project, cwd, into, only, confirm }) => {
    if (!gitAvailable()) throw new Error("git is not on PATH, so nothing can be cloned.");
    const scoped = await requireProject(project, cwd);
    const base = baseFor(scoped, into);
    const plan = planImport(
      scoped,
      await store.listRepos(scoped.id),
      state.listPaths(scoped.id).map((p) => p.path),
      base,
      { only },
    );

    if (!confirm) {
      return text(
        `${importPlanText(plan)}\n\nNothing has been written. Call import_project again with confirm:true to carry this out.`,
      );
    }
    return text(importResultText(plan, executeImport(state, plan)));
  },
);

/* -------------------------------------------------------------------- board */

server.registerTool(
  "open_board",
  {
    title: "Open the board",
    description:
      "Makes sure the board is up and returns the URL, starting it if it was not running. Use it once " +
      "you have finished recording, and hand the user the link with one sentence on what blocks what. " +
      "Pass open:true when the user asked to see the board rather than to be told about it.",
    inputSchema: z.object({
      project: z.string().optional(),
      task: z.string().optional(),
      cwd: z.string().optional(),
      open: z
        .boolean()
        .optional()
        .describe("Also bring the browser up on it. Off by default: recording a task should not steal focus."),
    }),
  },
  async ({ project, task, cwd, open }) => {
    const { url, started } = await ensureUp();
    let target = url;
    if (task) target = taskUrl(task);
    else {
      const scoped = project || cwd ? await requireProject(project, cwd) : null;
      if (scoped) target = projectUrl(scoped.slug);
    }
    if (open) {
      const { spawn } = await import("node:child_process");
      const { openerCommand } = await import("@/lib/runtime");
      const opener = openerCommand(target);
      spawn(opener.command, opener.args, { detached: true, stdio: "ignore" }).unref();
    }
    return text(`${started ? "Started" : "Already up"}${open ? " and opened" : ""}: ${target}`);
  },
);

/* ----------------------------------------------------------------- resource */

server.registerResource(
  "open-tasks",
  new ResourceTemplate("tasks://project/{slug}/open", { list: undefined }),
  { description: "A project's open tasks, in markdown." },
  async (uri, { slug }) => {
    const project = await store.getProject(String(slug));
    if (!project) return { contents: [{ uri: uri.href, text: `No project "${slug}".` }] };
    const open = await store.listTasks({ projectId: project.id, state: "open" });
    return {
      contents: [
        { uri: uri.href, text: `# ${project.name} — open tasks\n\n${taskListText(open)}` },
      ],
    };
  },
);

void serveStdio(() => server);
console.error(`${PLUGIN_NAME} MCP server ${PLUGIN_VERSION} on stdio`);
