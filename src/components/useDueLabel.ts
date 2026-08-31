import { useFormatter, useTranslations } from "next-intl";

import { type DonePhrase, type DuePhrase, donePhrase, duePhrase } from "@/lib/format/due";

/**
 * Turns a deadline into the sentence the user reads. Every key is a literal here
 * so both the type checker and `eloqnt lint` can follow it; the decision of which
 * key to use lives in `@/lib/format/due`, where it is testable on its own.
 */
export function useDueLabel() {
  const t = useTranslations("due");
  const format = useFormatter();
  const day = (date: Date) => format.dateTime(date, { day: "numeric", month: "short" });

  function render(phrase: DuePhrase | DonePhrase | null): string | null {
    if (!phrase) return null;
    switch (phrase.key) {
      case "overdue":
        return t("overdue", { days: phrase.days });
      case "wasToday":
        return t("wasToday");
      case "today":
        return t("today");
      case "inDays":
        return t("inDays", { days: phrase.days });
      case "on":
        return t("on", { date: day(phrase.date) });
      case "doneToday":
        return t("doneToday");
      case "doneDaysAgo":
        return t("doneDaysAgo", { days: phrase.days });
      case "doneOn":
        return t("doneOn", { date: day(phrase.date) });
    }
  }

  return {
    due: (dueAt: string | null) => render(duePhrase(dueAt)),
    completed: (completedAt: string | null) => render(donePhrase(completedAt)),
  };
}
