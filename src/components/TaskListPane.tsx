import Link from "next/link";

import { useTranslations } from "next-intl";

import type { Owner, TaskSummary } from "@/lib/db/types";
import { BUCKET_ORDER, bucketOf, type DueBucket } from "@/lib/format/dates";
import { boardHref, type BoardParams } from "@/lib/url";

import { useDueLabel } from "./useDueLabel";

import { SearchBox } from "./SearchBox";

function Ticks({ done, total }: { done: number; total: number }) {
  if (total === 0) return null;
  // One mark per step reads faster than a fraction — until there are too many
  // marks to count, at which point a solid bar is the honest shape.
  const dense = total > 14;
  return (
    <div className={`ticks${dense ? " dense" : ""}`} aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`tick${i < done ? " on" : ""}`} />
      ))}
    </div>
  );
}

function TaskRow({
  task,
  base,
  params,
  showProject,
  selectedSlug,
}: {
  task: TaskSummary;
  base: string;
  params: BoardParams;
  showProject: boolean;
  selectedSlug?: string;
}) {
  const t = useTranslations("list");
  const label = useDueLabel();

  const isDone = task.state === "done";
  const overdue = !isDone && bucketOf(task.dueAt) === "overdue";
  const due = isDone ? label.completed(task.completedAt) : label.due(task.dueAt);
  const primary = task.projects.find((p) => p.isPrimary) ?? task.projects[0];

  return (
    <li>
      <Link
        href={boardHref(base, params, { task: task.slug })}
        className={`task${isDone ? " is-done" : ""}`}
        aria-current={selectedSlug === task.slug ? "true" : undefined}
      >
        <Ticks done={task.doneSteps} total={task.totalSteps} />
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          {showProject && primary ? (
            <>
              <span className="row-project">
                <span className="dot" style={{ ["--dot" as string]: `oklch(0.7 0.16 ${primary.hue})` }} />
                {primary.name}
              </span>
              <span className="sep">·</span>
            </>
          ) : null}
          {task.totalSteps > 0 ? (
            <span className="tabular">
              {task.doneSteps}/{task.totalSteps}
            </span>
          ) : (
            <span>{t("noSteps")}</span>
          )}
          {due ? (
            <>
              <span className="sep">·</span>
              <span className={overdue ? "overdue" : undefined}>{due}</span>
            </>
          ) : null}
          {task.projects.length > 1 ? <span className="badge-cross">{t("acrossProjects")}</span> : null}
          {task.owners.slice(0, 3).map((o) => (
            <span className="owner-tag" key={o.id}>
              {o.label}
            </span>
          ))}
        </div>
      </Link>
    </li>
  );
}

export function TaskListPane({
  title,
  lede,
  tasks,
  counts,
  owners,
  base,
  params,
  showProject = false,
  selectedSlug,
}: {
  title: string;
  lede?: string | null;
  tasks: TaskSummary[];
  counts: { open: number; done: number; all: number };
  owners: Owner[];
  base: string;
  params: BoardParams;
  showProject?: boolean;
  selectedSlug?: string;
}) {
  const t = useTranslations("list");
  const tBucket = useTranslations("bucket");
  const state = params.state ?? "open";
  const grouped = new Map<DueBucket | "done", TaskSummary[]>();
  for (const task of tasks) {
    const key = task.state === "done" ? "done" : bucketOf(task.dueAt);
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  }
  const buckets: Array<[string, string, TaskSummary[]]> = [];
  for (const bucket of BUCKET_ORDER) {
    const list = grouped.get(bucket);
    if (list?.length) buckets.push([bucket, tBucket(bucket), list]);
  }
  const done = grouped.get("done");
  if (done?.length) buckets.push(["done", tBucket("done"), done]);

  const hasFilters = Boolean(params.owner || params.q);

  return (
    <section className="pane list-pane">
      <div className="pane-head">
        <h1 className="list-title">{title}</h1>
        {lede ? <p className="list-lede">{lede}</p> : null}

        <nav className="segmented">
          {(
            [
              ["open", t("open"), counts.open],
              ["done", t("completed"), counts.done],
              ["all", t("all"), counts.all],
            ] as const
          ).map(([key, label, n]) => (
            <Link
              key={key}
              href={boardHref(base, params, { state: key === "open" ? undefined : key, task: undefined })}
              className="segment"
              aria-current={state === key ? "true" : undefined}
            >
              {label}
              <span className="n tabular">{n}</span>
            </Link>
          ))}
        </nav>

        <SearchBox initial={params.q ?? ""} />

        {owners.length > 0 ? (
          <div className="chips">
            {owners.map((owner) => {
              const active = params.owner === owner.slug;
              return (
                <Link
                  key={owner.id}
                  href={boardHref(base, params, { owner: active ? undefined : owner.slug, task: undefined })}
                  className="chip"
                  aria-pressed={active}
                >
                  {owner.label}
                </Link>
              );
            })}
            {hasFilters ? (
              <Link
                href={boardHref(base, { state: params.state })}
                className="chip clear"
                aria-label={t("clearFiltersLabel")}
              >
                {t("clearFilters")}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="pane-scroll">
      {buckets.length === 0 ? (
        <p className="empty">
          {hasFilters ? t("emptyFiltered") : state === "done" ? t("emptyDone") : t("emptyOpen")}
        </p>
      ) : (
        buckets.map(([key, label, list]) => (
          <div key={key}>
            <h2 className={`bucket-head${key === "overdue" ? " is-overdue" : ""}`}>
              {label}
              <span className="n">{list.length}</span>
            </h2>
            <ul className="task-list">
              {list.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  base={base}
                  params={params}
                  showProject={showProject}
                  selectedSlug={selectedSlug}
                />
              ))}
            </ul>
          </div>
        ))
      )}
      </div>
    </section>
  );
}
