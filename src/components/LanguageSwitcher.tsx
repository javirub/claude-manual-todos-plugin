"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { setBoardLocale } from "@/app/actions";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/db/settings";

/**
 * The choice is stored, not held in the URL: it also tells the agent which
 * language to write new tasks in, so it has to outlive the tab.
 */
export function LanguageSwitcher({ current }: { current: Locale }) {
  const t = useTranslations("app");
  const [pending, startTransition] = useTransition();

  return (
    <div className="lang" aria-busy={pending}>
      <span className="rail-section lang-label">{t("language")}</span>
      <div className="chips">
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            className="chip"
            aria-pressed={locale === current}
            disabled={pending || locale === current}
            onClick={() => startTransition(() => setBoardLocale(locale))}
          >
            {LOCALE_LABELS[locale]}
          </button>
        ))}
      </div>
    </div>
  );
}
