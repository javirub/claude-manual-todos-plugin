"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/**
 * A value the user is about to paste somewhere else. Exact values with a copy
 * button are the difference between a step that takes ten seconds and one that
 * takes a trip through three consoles to find the string again.
 */
export function Copyable({ value, block = false }: { value: string; block?: boolean }) {
  const t = useTranslations("step");
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timeout.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Same-origin localhost normally grants this; if a browser refuses, say so
      // instead of silently doing nothing.
      setCopied(false);
      window.prompt(t("copyManually"), value);
      return;
    }
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="copyable">
      {block ? <pre>{value}</pre> : <code>{value}</code>}
      <button
        type="button"
        className={`copy-btn${copied ? " done" : ""}`}
        onClick={copy}
        aria-label={t("copyLabel", { value })}
      >
        {copied ? t("copied") : t("copy")}
      </button>
    </div>
  );
}
