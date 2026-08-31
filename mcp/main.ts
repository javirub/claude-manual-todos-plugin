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
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod";

import { getDb } from "@/lib/db";
import { boardOrigin } from "@/lib/db/paths";
import { LOCALES, LOCALE_LABELS, getLocale, setLocale, type Locale } from "@/lib/db/settings";
import {
  HueTooCloseError,
  addProjectPath,
  createProject,
  getProject,
  linkProjects,
  listProjectRelations,
  listProjects,
  resolveProjectByPath,
  setProjectTheme,
  suggestFreeHue,
  updateProject,
  upsertOwner,
} from "@/lib/db/projects";
import {
  addSteps,
  createTask,
  deleteStep,
  deleteTask,
  getTask,
  linkTasks,
  listTasks,
  setStepsDone,
  setTaskDone,
  updateStep,
  updateTask,
} from "@/lib/db/tasks";
import type { Project } from "@/lib/db/types";
import { projectDetailText, projectLine, taskDetailText, taskListText } from "@/lib/format/text";

const db = getDb();

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });

/**
 * The single most useful thing to tell an agent that is about to write a task:
 * which language to write it in. It is repeated on every where_am_i so it cannot
 * be missed halfway through a long session.
 */
function languageLine(): string {
  const locale = getLocale(db);
  return `Write task content in ${LOCALE_LABELS[locale]} (${locale}) — titles, summaries, step bodies, reasons and phase names.`;
}

function requireProject(ref: string | undefined, cwd: string | undefined): Project {
  if (ref) {
    const found = getProject(db, ref);
    if (found) return found;
    const known = listProjects(db).map((p) => p.slug).join(", ") || "none";
    throw new Error(`No project "${ref}". The ones that exist: ${known}.`);
  }
  const resolved = resolveProjectByPath(db, cwd ?? process.cwd());
  if (resolved) return resolved.project;
  throw new Error(
    `The path ${cwd ?? process.cwd()} belongs to no project. ` +
      `Call where_am_i to see the options, then either create the project with create_project ` +
      `or attach the path to an existing one with add_project_path before recording anything.`,
  );
}

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
  title: z.string().describe("One imperative action someone can finish in a sitting. Written in Spanish."),
  body: z.string().nullish().describe("Where it is in the UI and what to do, in markdown and in Spanish. Code fences render with a copy button."),
  why: z.string().nullish().describe("What happens if they skip it, when the consequence is not obvious. A manual step with no reason gets skipped or done wrong. In Spanish."),
  value: z.string().nullish().describe("The exact value they will paste: an identifier, a URL, a bucket name. Renders with a copy button."),
  linkUrl: z.string().nullish().describe("Link to the console where it is done, not to the documentation."),
  linkLabel: z.string().nullish(),
  owner: z.string().nullish().describe("Who or where: apple, gitlab, cluster, infisical… Created on demand if it did not exist."),
  done: z.boolean().optional().describe("true if already resolved. A step you resolved in code is recorded as done, not omitted: seeing what is already closed is half the context for the rest."),
  doneBy: z.enum(["user", "agent"]).optional(),
});

const server = new McpServer({ name: "claude-manual-todos-plugin", version: "0.1.0" });

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
    const resolved = resolveProjectByPath(db, where);
    if (!resolved) {
      const projects = listProjects(db);
      return text(
        `${where} belongs to no project.\n${languageLine()}\n\n` +
          (projects.length
            ? `Projects that already exist:\n${projects.map((p) => `  ${projectLine(p)}`).join("\n")}\n\n` +
              `If this path is another repository of one of them, attach it with add_project_path ` +
              `(one project spans several repos). If it is a new project, create it with create_project: ` +
              `you will have to give it its own identity, and the widest free hue right now is ${suggestFreeHue(db)}°.`
            : `There are no projects yet. Create the first one with create_project. ` +
              `A free hue to start from: ${suggestFreeHue(db)}°.`),
      );
    }

    const { project, path } = resolved;
    const open = listTasks(db, { projectId: project.id, state: "open" });
    const relations = listProjectRelations(db, project.id);
    const lines = [
      projectDetailText(project),
      `\nYou are in ${path.path}${path.role ? ` (${path.role})` : ""}.`,
      languageLine(),
    ];
    if (relations.length) {
      lines.push(`Related to: ${relations.map((r) => `${r.project.name} (${r.kind})`).join(", ")}.`);
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
    const projects = listProjects(db, includeArchived ?? false);
    if (!projects.length) return text("There are no projects.");
    return text(projects.map((p) => projectDetailText(p)).join("\n\n"));
  },
);

server.registerTool(
  "create_project",
  {
    title: "Create project",
    description:
      "Registers a project and its visual identity. A project can span several repositories: pass them " +
      "all in `paths`. The identity is invented HERE and only here, when a project that did not exist " +
      "needs tasks recorded against it; pick a hue that matches the product and sits 25° or more from " +
      "every other project, or leave it out to get the widest free gap.",
    inputSchema: z.object({
      name: z.string(),
      summary: z.string().nullish(),
      paths: z
        .array(
          z.object({
            path: z.string(),
            label: z.string().nullish(),
            role: z.string().nullish().describe("frontend, backend, docs, cluster… Shown in the board's rail, so Spanish reads better here."),
          }),
        )
        .optional(),
      owners: z.array(z.object({ slug: z.string(), label: z.string().optional() })).optional(),
      theme: themeSchema.optional(),
    }),
  },
  async (input) => {
    try {
      const project = createProject(db, {
        name: input.name,
        summary: input.summary,
        paths: input.paths,
        owners: input.owners,
        theme: input.theme,
      });
      return text(`Created.\n\n${projectDetailText(project)}`);
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
    const found = requireProject(project, undefined);
    for (const owner of owners ?? []) upsertOwner(db, found.id, owner);
    return text(projectDetailText(updateProject(db, found.id, patch)));
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
    const found = requireProject(project, undefined);
    addProjectPath(db, found.id, { path, role, label });
    return text(projectDetailText(getProject(db, found.id)!));
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
    const a = requireProject(from, undefined);
    const b = requireProject(to, undefined);
    linkProjects(db, a.id, b.id, kind ?? "relates", note);
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
    const found = requireProject(project, undefined);
    try {
      return text(projectDetailText(setProjectTheme(db, found.id, theme)));
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
    setLocale(db, locale as Locale);
    return text(`Language set to ${LOCALE_LABELS[locale as Locale]} (${locale}). ${languageLine()}`);
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
    const scoped = allProjects ? undefined : requireProject(project, cwd);
    const tasks = listTasks(db, {
      projectId: scoped?.id,
      state,
      ownerSlug: owner,
      dueBefore,
      query,
    });
    const header = `${scoped ? scoped.name : "All projects"} — ${tasks.length} task(s)`;
    if (!withSteps) return text(`${header}\n\n${taskListText(tasks, { showProject: !scoped })}`);
    const details = tasks.map((t) => taskDetailText(getTask(db, t.id)!)).join("\n\n———\n\n");
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
    const found = getTask(db, /^\d+$/.test(task) ? Number(task) : task);
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
      "that does not exist is worse than having no phases. Content in Spanish.",
    inputSchema: z.object({
      project: z.string().optional(),
      cwd: z.string().optional(),
      alsoProjects: z.array(z.string()).optional().describe("Other projects this same task also belongs to."),
      title: z.string(),
      summary: z.string().nullish().describe("A sentence or two on why the task exists and what it unblocks. In Spanish."),
      dueAt: z.string().nullish().describe("YYYY-MM-DD, only when there is a real date. Do not invent deadlines: they empty the overdue bucket of meaning."),
      phases: z.array(z.object({ name: z.string(), note: z.string().nullish(), steps: z.array(stepSchema) })).optional(),
      steps: z.array(stepSchema).optional(),
      sourcePath: z.string().nullish(),
    }),
  },
  async ({ project, cwd, alsoProjects, ...input }) => {
    const scoped = requireProject(project, cwd);
    const also = (alsoProjects ?? []).map((slug) => requireProject(slug, undefined).id);
    const created = createTask(db, {
      ...input,
      projectId: scoped.id,
      alsoProjectIds: also,
      sourcePath: input.sourcePath ?? cwd ?? null,
    });
    return text(`Recorded in ${scoped.name}.\n\n${taskDetailText(created)}\n\n${boardOrigin()}/t/${created.slug}`);
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
    const found = getTask(db, /^\d+$/.test(task) ? Number(task) : task);
    if (!found) return text(`No task "${task}".`);
    const also = alsoProjects?.map((slug) => requireProject(slug, undefined).id);
    return text(taskDetailText(updateTask(db, found.id, { ...patch, alsoProjectIds: also })));
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
      phase: z.string().nullish().describe("Phase name, in Spanish. Created at the end if it does not exist."),
      steps: z.array(stepSchema),
    }),
  },
  async ({ task, phase, steps }) => {
    const found = getTask(db, /^\d+$/.test(task) ? Number(task) : task);
    if (!found) return text(`No task "${task}".`);
    return text(taskDetailText(addSteps(db, found.id, steps, phase)));
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
      stepId: z.number(),
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
    updateStep(db, stepId, patch);
    const row = db.prepare("SELECT task_id FROM steps WHERE id = ?").get<{ task_id: number }>(stepId);
    if (!row) return text(`No step ${stepId}.`);
    return text(taskDetailText(getTask(db, row.task_id)!));
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
      stepIds: z.array(z.number()),
      by: z.enum(["user", "agent"]).optional(),
    }),
  },
  async ({ stepIds, by }) => {
    const taskIds = setStepsDone(db, stepIds, true, by ?? "agent");
    if (!taskIds.length) return text("None of those steps exist.");
    return text(taskIds.map((id) => taskDetailText(getTask(db, id)!)).join("\n\n———\n\n"));
  },
);

server.registerTool(
  "reopen_steps",
  {
    title: "Reopen steps",
    description: "Puts steps back to pending.",
    inputSchema: z.object({ stepIds: z.array(z.number()) }),
  },
  async ({ stepIds }) => {
    const taskIds = setStepsDone(db, stepIds, false, "agent");
    if (!taskIds.length) return text("None of those steps exist.");
    return text(taskIds.map((id) => taskDetailText(getTask(db, id)!)).join("\n\n———\n\n"));
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
    const found = getTask(db, /^\d+$/.test(task) ? Number(task) : task);
    if (!found) return text(`No task "${task}".`);
    return text(taskDetailText(setTaskDone(db, found.id, true, by ?? "agent")));
  },
);

server.registerTool(
  "delete_step",
  {
    title: "Delete a step",
    description: "For a step that stopped making sense. If it merely changed, edit it with update_step.",
    inputSchema: z.object({ stepId: z.number() }),
  },
  async ({ stepId }) => {
    const row = db.prepare("SELECT task_id FROM steps WHERE id = ?").get<{ task_id: number }>(stepId);
    if (!row) return text(`No step ${stepId}.`);
    deleteStep(db, stepId);
    return text(taskDetailText(getTask(db, row.task_id)!));
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
    const found = getTask(db, /^\d+$/.test(task) ? Number(task) : task);
    if (!found) return text(`No task "${task}".`);
    deleteTask(db, found.id);
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
    const a = getTask(db, /^\d+$/.test(from) ? Number(from) : from);
    const b = getTask(db, /^\d+$/.test(to) ? Number(to) : to);
    if (!a || !b) return text(`Cannot find ${!a ? from : to}.`);
    linkTasks(db, a.id, b.id, kind ?? "relates");
    return text(taskDetailText(getTask(db, a.id)!));
  },
);

/* -------------------------------------------------------------------- board */

server.registerTool(
  "open_board",
  {
    title: "Open the board",
    description:
      "Makes sure the board is up and returns the URL, starting it if it was not running. Use it once " +
      "you have finished recording, and hand the user the link with one sentence on what blocks what.",
    inputSchema: z.object({
      project: z.string().optional(),
      task: z.string().optional(),
      cwd: z.string().optional(),
    }),
  },
  async ({ project, task, cwd }) => {
    const { ensureUp } = await import("../bin/tasks");
    const { url, started } = await ensureUp();
    let target = url;
    if (task) target = `${url}/t/${task}`;
    else {
      const scoped = project || cwd ? requireProject(project, cwd) : null;
      if (scoped) target = `${url}/p/${scoped.slug}`;
    }
    return text(`${started ? "Started" : "Already up"}: ${target}`);
  },
);

/* ----------------------------------------------------------------- resource */

server.registerResource(
  "open-tasks",
  new ResourceTemplate("tasks://project/{slug}/open", { list: undefined }),
  { description: "A project's open tasks, in markdown." },
  async (uri, { slug }) => {
    const project = getProject(db, String(slug));
    if (!project) return { contents: [{ uri: uri.href, text: `No project "${slug}".` }] };
    const open = listTasks(db, { projectId: project.id, state: "open" });
    return {
      contents: [
        { uri: uri.href, text: `# ${project.name} — open tasks\n\n${taskListText(open)}` },
      ],
    };
  },
);

void serveStdio(() => server);
console.error("claude-manual-todos MCP server on stdio");
