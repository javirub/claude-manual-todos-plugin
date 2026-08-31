import Link from "next/link";
import { useTranslations } from "next-intl";

import type { Task } from "@/lib/db/types";
import { bucketOf } from "@/lib/format/dates";
import { boardHref, type BoardParams } from "@/lib/url";

import { useDueLabel } from "./useDueLabel";

import { StepRow } from "./StepRow";

export function TaskDetail({ task, params }: { task: Task; params: BoardParams }) {
  const t = useTranslations("detail");
  const label = useDueLabel();

  const isDone = task.state === "done";
  const overdue = !isDone && bucketOf(task.dueAt) === "overdue";
  const due = isDone ? label.completed(task.completedAt) : label.due(task.dueAt);
  const percent = task.totalSteps ? (task.doneSteps / task.totalSteps) * 100 : isDone ? 100 : 0;

  // Numbering runs across the whole task, not per phase: the user works down one
  // list, and "step 7" has to mean one thing.
  let counter = 0;

  return (
    <article className="pane detail-pane">
      <div className="pane-scroll">
      <div className="detail-wrap">
        <header className="detail-head">
          <div className="detail-facts">
            {task.projects.map((project) => (
              <Link
                key={project.id}
                href={boardHref(`/p/${project.slug}`, {})}
                className="project-chip"
                title={project.isPrimary ? t("primaryProject") : t("alsoInThisProject")}
              >
                <span
                  className="dot"
                  style={{ ["--dot" as string]: `oklch(0.7 0.16 ${project.hue})` }}
                />
                {project.name}
              </Link>
            ))}
            {due ? <span className={overdue ? "overdue" : undefined}>{due}</span> : null}
            {task.createdBy === "agent" ? <span>{t("recordedByClaude")}</span> : null}
          </div>

          <h1 className="detail-title">{task.title}</h1>
          {task.summary ? <p className="detail-lede">{task.summary}</p> : null}

          <div className={`meter${isDone ? " is-done" : ""}`}>
            <div className="track">
              <div className="fill" style={{ width: `${percent}%` }} />
            </div>
            <span className="tally tabular">
              {task.totalSteps === 0
                ? isDone
                  ? t("taskDone")
                  : t("noStepsShort")
                : t("progress", { done: task.doneSteps, total: task.totalSteps })}
            </span>
          </div>

          {task.links.length > 0 ? (
            <div className="relations">
              {task.links.map((link) => (
                <Link
                  key={`${link.kind}-${link.direction}-${link.task.id}`}
                  href={boardHref("/", params, { task: link.task.slug })}
                  className={`relation${link.kind === "blocks" ? " blocking" : ""}`}
                >
                  <span className="kind">
                    {link.kind === "blocks"
                      ? link.direction === "outgoing"
                        ? t("blocks")
                        : t("blockedBy")
                      : t("relates")}
                  </span>
                  <span>{link.task.title}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </header>

        {task.phases.map((phase) => (
          <section className="phase" key={phase.id}>
            <div className="phase-head">
              <span className="phase-ordinal">{String(phase.position).padStart(2, "0")}</span>
              <h2>{phase.name}</h2>
              <span className="phase-count tabular">
                {phase.steps.filter((s) => s.doneAt).length}/{phase.steps.length}
              </span>
            </div>
            {phase.note ? <p className="phase-note">{phase.note}</p> : null}
            <ul className="steps">
              {phase.steps.map((step) => (
                <StepRow key={step.id} step={step} index={(counter += 1)} />
              ))}
            </ul>
          </section>
        ))}

        {task.looseSteps.length > 0 ? (
          <section className="phase">
            {task.phases.length > 0 ? (
              <div className="phase-head">
                <span className="phase-ordinal">··</span>
                <h2>{t("noPhase")}</h2>
              </div>
            ) : null}
            <ul className="steps">
              {task.looseSteps.map((step) => (
                <StepRow key={step.id} step={step} index={(counter += 1)} />
              ))}
            </ul>
          </section>
        ) : null}

        {task.totalSteps === 0 ? (
          <p className="empty">{t("noSteps")}</p>
        ) : null}
      </div>
      </div>
    </article>
  );
}

export function DetailEmpty({ open, overdue }: { open: number; overdue: number }) {
  const t = useTranslations("detail");
  return (
    <article className="pane detail-pane">
      <div className="detail-empty">
        <h2>{open === 0 ? t("nothing") : t("pickOne")}</h2>
        <p>
          {open === 0
            ? t("nothingBody")
            : overdue > 0
              ? t("countOverdue", { count: open, overdue })
              : t("countOpen", { count: open })}
        </p>
      </div>
    </article>
  );
}
