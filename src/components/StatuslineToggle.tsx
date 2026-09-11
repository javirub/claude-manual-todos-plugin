"use client";

import { useTranslations } from "next-intl";
import { useOptimistic, useTransition } from "react";

import { setStatuslineForProject } from "@/app/actions";

/**
 * The status bar in Claude Code is the one place this board is visible without
 * opening it — and the one place a project nobody is working on is pure noise.
 * Per project, because "on" and "off" are rarely the answer for all of them.
 */
export function StatuslineToggle({ slug, enabled }: { slug: string; enabled: boolean }) {
  const t = useTranslations("statusline");
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useOptimistic(enabled);

  return (
    <div className="lang" aria-busy={pending}>
      <span className="rail-section lang-label">{t("label")}</span>
      <div className="chips">
        <button
          type="button"
          className="chip"
          aria-pressed={on}
          disabled={pending}
          title={t("hint")}
          onClick={() =>
            startTransition(async () => {
              setOn(!on);
              await setStatuslineForProject(slug, !on);
            })
          }
        >
          {on ? t("on") : t("off")}
        </button>
      </div>
    </div>
  );
}
