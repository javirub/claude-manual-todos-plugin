import { getTranslations } from "next-intl/server";

import { LiveRefresh } from "@/components/LiveRefresh";
import { Rail } from "@/components/Rail";
import { DetailEmpty, TaskDetail } from "@/components/TaskDetail";
import { TaskListPane } from "@/components/TaskListPane";
import { loadBoard } from "@/lib/board";
import { readParams } from "@/lib/url";

export const dynamic = "force-dynamic";

export default async function AllProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = readParams(await searchParams);
  const { projects, tasks, counts, owners, selected, totals, locale } = loadBoard(params);
  const t = await getTranslations("list");
  const tRail = await getTranslations("rail");

  return (
    <div className="shell" data-detail={params.task ? "open" : "closed"}>
      <LiveRefresh />
      <Rail projects={projects} active={null} params={params} totals={totals} locale={locale} />
      <TaskListPane
        title={tRail("allProjects")}
        lede={projects.length ? t("allProjectsLede") : t("noProjectsYet")}
        tasks={tasks}
        counts={counts}
        owners={owners}
        base="/"
        params={params}
        showProject
        selectedSlug={selected?.slug}
      />
      {selected ? (
        <TaskDetail task={selected} params={params} />
      ) : (
        <DetailEmpty open={counts.open} overdue={totals.overdue} />
      )}
    </div>
  );
}
