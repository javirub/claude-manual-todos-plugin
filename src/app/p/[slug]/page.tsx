import { notFound } from "next/navigation";

import { LiveRefresh } from "@/components/LiveRefresh";
import { Rail } from "@/components/Rail";
import { DetailEmpty, TaskDetail } from "@/components/TaskDetail";
import { TaskListPane } from "@/components/TaskListPane";
import { loadBoard } from "@/lib/board";
import { themeStyleSheet } from "@/lib/theme/tokens";
import { readParams } from "@/lib/url";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await routeParams;
  const params = readParams(await searchParams);
  const { projects, active, tasks, counts, owners, selected, totals, locale } = loadBoard(params, slug);
  if (!active) notFound();


  return (
    <div className="shell" data-detail={params.task ? "open" : "closed"}>
      {/* The project's identity, later in the cascade than the neutral default. */}
      <style dangerouslySetInnerHTML={{ __html: themeStyleSheet(active.theme) }} />
      <LiveRefresh />
      <Rail projects={projects} active={active} params={params} totals={totals} locale={locale} />
      <TaskListPane
        title={active.name}
        lede={active.summary}
        tasks={tasks}
        counts={counts}
        owners={owners}
        base={`/p/${active.slug}`}
        params={params}
        selectedSlug={selected?.slug}
      />
      {selected ? (
        <TaskDetail task={selected} params={params} />
      ) : (
        <DetailEmpty open={counts.open} overdue={active.counts.overdue} />
      )}
    </div>
  );
}
