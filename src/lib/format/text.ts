import type { Project, Task, TaskSummary } from "@/lib/db/types";

import { BUCKET_ORDER, bucketOf, daysBetween, type DueBucket } from "./dates";

/**
 * Everything an agent reads back from this tool is plain text, not JSON: the
 * point is that Claude can compare what it was about to write against what is
 * already recorded, cheaply and without parsing.
 *
 * The labels here are English, unlike the ones in ./dates, which are what the
 * board shows the user. Same data, two audiences: the agent reads the scaffolding
 * of this file, the user reads the interface. Task content stays Spanish in both.
 */

const EN_DATE = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });

const BUCKET_EN: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  none: "No date",
};

function dueEn(dueAt: string | null, now = new Date()): string | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const days = daysBetween(now, due);
  if (days < -1) return `overdue by ${-days} days`;
  if (days === -1) return "overdue since yesterday";
  if (days === 0) return due.getTime() < now.getTime() ? "was due today" : "due today";
  if (days === 1) return "due tomorrow";
  if (days <= 7) return `due in ${days} days`;
  return `due ${EN_DATE.format(due)}`;
}

function completedEn(completedAt: string | null, now = new Date()): string | null {
  if (!completedAt) return null;
  const days = daysBetween(new Date(completedAt), now);
  if (days === 0) return "done today";
  if (days === 1) return "done yesterday";
  if (days < 7) return `done ${days} days ago`;
  return `done ${EN_DATE.format(new Date(completedAt))}`;
}

function progress(task: TaskSummary): string {
  if (task.totalSteps === 0) return task.state === "done" ? "done" : "no steps";
  return `${task.doneSteps}/${task.totalSteps}`;
}

export function taskLine(task: TaskSummary, options: { showProject?: boolean } = {}): string {
  const bits = [`[${task.slug}]`, task.title, `— ${progress(task)}`];
  const meta: string[] = [];
  if (options.showProject) {
    const primary = task.projects.find((p) => p.isPrimary) ?? task.projects[0];
    if (primary) meta.push(primary.name);
  }
  if (task.projects.length > 1) meta.push(`across: ${task.projects.map((p) => p.name).join(" + ")}`);
  const due = task.state === "done" ? completedEn(task.completedAt) : dueEn(task.dueAt);
  if (due) meta.push(due);
  if (task.owners.length) meta.push(task.owners.map((o) => o.slug).join(", "));
  return `${bits.join(" ")}${meta.length ? ` (${meta.join(" · ")})` : ""}`;
}

export function taskListText(tasks: TaskSummary[], options: { showProject?: boolean } = {}): string {
  if (!tasks.length) return "None.";
  const grouped = new Map<string, TaskSummary[]>();
  for (const task of tasks) {
    const key = task.state === "done" ? "done" : bucketOf(task.dueAt);
    const list = grouped.get(key) ?? [];
    list.push(task);
    grouped.set(key, list);
  }
  const sections: string[] = [];
  for (const bucket of BUCKET_ORDER) {
    const list = grouped.get(bucket);
    if (list?.length) {
      sections.push(`${BUCKET_EN[bucket].toUpperCase()} (${list.length})\n${list.map((t) => `  ${taskLine(t, options)}`).join("\n")}`);
    }
  }
  const done = grouped.get("done");
  if (done?.length) {
    sections.push(`DONE (${done.length})\n${done.map((t) => `  ${taskLine(t, options)}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

export function taskDetailText(task: Task): string {
  const lines: string[] = [];
  lines.push(`${task.title}  [${task.slug}]`);
  lines.push(
    `${task.projects.map((p) => p.name + (p.isPrimary ? "" : " (also)")).join(" · ")} — ${progress(task)} — ${task.state}`,
  );
  const due = dueEn(task.dueAt);
  if (due) lines.push(due);
  if (task.summary) lines.push(`\n${task.summary}`);

  for (const link of task.links) {
    const verb =
      link.kind === "blocks"
        ? link.direction === "outgoing"
          ? "blocks"
          : "is blocked by"
        : "relates to";
    lines.push(`↳ ${verb} [${link.task.slug}] ${link.task.title} (${link.task.state})`);
  }

  const renderStep = (step: Task["looseSteps"][number], index: number): string => {
    const box = step.doneAt ? (step.doneBy === "agent" ? "[x by agent]" : "[x]") : "[ ]";
    const parts = [`  ${box} ${index}. ${step.title}${step.owner ? ` (${step.owner.slug})` : ""}`];
    if (step.bodyMd) parts.push(`        ${step.bodyMd.replace(/\n/g, "\n        ")}`);
    if (step.why) parts.push(`        why: ${step.why}`);
    if (step.value) parts.push(`        value: ${step.value}`);
    if (step.linkUrl) parts.push(`        link: ${step.linkUrl}${step.linkLabel ? ` (${step.linkLabel})` : ""}`);
    parts.push(`        id: ${step.id}`);
    return parts.join("\n");
  };

  let n = 0;
  for (const phase of task.phases) {
    lines.push(`\n${phase.position} · ${phase.name.toUpperCase()}`);
    if (phase.note) lines.push(`  ${phase.note}`);
    for (const step of phase.steps) lines.push(renderStep(step, (n += 1)));
  }
  if (task.looseSteps.length) {
    if (task.phases.length) lines.push("\nNO PHASE");
    else lines.push("");
    for (const step of task.looseSteps) lines.push(renderStep(step, (n += 1)));
  }
  return lines.join("\n");
}

export function projectLine(project: Project): string {
  const bits = [`${project.name} [${project.slug}]`];
  const counts: string[] = [];
  if (project.counts.open) counts.push(`${project.counts.open} open`);
  if (project.counts.overdue) counts.push(`${project.counts.overdue} overdue`);
  if (project.counts.done) counts.push(`${project.counts.done} done`);
  bits.push(counts.length ? `— ${counts.join(", ")}` : "— no tasks");
  return bits.join(" ");
}

export function projectDetailText(project: Project): string {
  const lines = [projectLine(project)];
  if (project.summary) lines.push(project.summary);
  if (project.paths.length) {
    lines.push("Paths:");
    for (const p of project.paths) lines.push(`  ${p.path}${p.role ? `  (${p.role})` : ""}`);
  }
  if (project.owners.length) lines.push(`Owners: ${project.owners.map((o) => o.slug).join(", ")}`);
  const t = project.theme;
  lines.push(
    `Theme: ${t.mode}, hue ${Math.round(t.hue)}°, chroma ${t.chroma}, motif ${t.motif}, heading ${t.fontHeading}`,
  );
  return lines.join("\n");
}
