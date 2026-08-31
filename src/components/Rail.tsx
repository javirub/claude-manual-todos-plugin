import Link from "next/link";
import { useTranslations } from "next-intl";

import type { Locale } from "@/lib/db/settings";
import type { Project } from "@/lib/db/types";
import { boardHref, type BoardParams } from "@/lib/url";

import { LanguageSwitcher } from "./LanguageSwitcher";

/**
 * A project's dot always carries that project's own hue, even while the
 * interface is wearing another project's theme — the colour has to mean the same
 * thing wherever it shows up, or the whole point of theming per project is lost.
 */
function dotStyle(hue: number): React.CSSProperties {
  return { ["--dot" as string]: `oklch(0.7 0.16 ${hue})` };
}

export function Rail({
  projects,
  active,
  params,
  totals,
  locale,
}: {
  projects: Project[];
  active: Project | null;
  params: BoardParams;
  totals: { open: number; overdue: number };
  locale: Locale;
}) {
  const t = useTranslations("rail");
  const tApp = useTranslations("app");
  return (
    <aside className="pane rail">
      <div className="pane-head">
        <div className="wordmark">{tApp("name")}</div>
      </div>

      <div className="pane-scroll">
      <p className="rail-section">{t("projects")}</p>
      <ul className="project-list">
        <li>
          <Link
            href={boardHref("/", params, { task: undefined })}
            className="project"
            aria-current={active === null ? "page" : undefined}
            style={dotStyle(250)}
          >
            <span className="dot" style={{ background: "var(--faint)" }} />
            <span className="project-name">{t("allProjects")}</span>
            <span className={`count${totals.overdue ? " has-overdue" : ""}`}>{totals.open || "·"}</span>
          </Link>
        </li>
        {projects.map((project) => (
          <li key={project.id}>
            <Link
              href={boardHref(`/p/${project.slug}`, params, { task: undefined })}
              className="project"
              aria-current={active?.id === project.id ? "page" : undefined}
              style={dotStyle(project.theme.hue)}
            >
              <span className="dot" />
              <span className="project-name">{project.name}</span>
              <span
                className={`count${project.counts.overdue ? " has-overdue" : ""}`}
                title={project.counts.overdue ? t("overdueTitle", { count: project.counts.overdue }) : undefined}
              >
                {project.counts.open || "·"}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {active && active.paths.length > 0 ? (
        <>
          <p className="rail-section">{t("repositories")}</p>
          <ul className="repo-list">
            {active.paths.map((path) => (
              <li className="repo" key={path.id} title={path.path}>
                <code>{path.label || path.path.split("/").slice(-1)[0]}</code>
                {path.role ? <span className="repo-role">{path.role}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      </div>

      <div className="rail-foot">
        <LanguageSwitcher current={locale} />
      </div>
    </aside>
  );
}
