"use client";

import { useTranslations } from "next-intl";
import { useOptimistic, useTransition } from "react";

import { toggleStep } from "@/app/actions";
import type { Step } from "@/lib/db/types";

import { Copyable } from "./Copyable";
import { Markdown } from "./Markdown";

/**
 * Ticking is optimistic: the mark lands immediately and the row dims while the
 * write is in flight. If the write throws, React rolls the optimistic value
 * back on its own and the box returns to where it was.
 */
export function StepRow({ step, index }: { step: Step; index: number }) {
  const t = useTranslations("step");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useOptimistic(step.doneAt !== null);

  const inputId = `step-${step.id}`;

  return (
    <li className={`step${done ? " is-done" : ""}${pending ? " is-pending-write" : ""}`}>
      <input
        id={inputId}
        type="checkbox"
        className="step-check"
        checked={done}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.checked;
          startTransition(async () => {
            setDone(next);
            await toggleStep(step.id, next);
          });
        }}
      />
      <div>
        <label className="step-title" htmlFor={inputId}>
          <span className="tabular" style={{ color: "var(--faint)", marginRight: ".4rem" }}>
            {index}
          </span>
          {step.title}
          <span className="step-tags">
            {step.owner ? <span className="owner-tag">{step.owner.label}</span> : null}
            {done && step.doneBy === "agent" ? (
              <span className="by-agent" title={t("resolvedInCodeTitle")}>
                {t("resolvedInCode")}
              </span>
            ) : null}
          </span>
        </label>

        {step.bodyMd ? (
          <div className="step-body">
            <Markdown source={step.bodyMd} />
          </div>
        ) : null}

        {step.why ? (
          <div className="why">
            <b>{t("why")}</b>
            {/* The reason gets the same markdown as the body: it is written by
                the same hand, and an unrendered **no** changes what it means. */}
            <Markdown source={step.why} />
          </div>
        ) : null}

        {step.value ? <Copyable value={step.value} /> : null}

        {step.linkUrl ? (
          <a className="step-link" href={step.linkUrl} target="_blank" rel="noreferrer noopener">
            ↗ {step.linkLabel || new URL(step.linkUrl).hostname}
          </a>
        ) : null}
      </div>
    </li>
  );
}
