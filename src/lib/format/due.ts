import { daysBetween } from "./dates";

/**
 * Which phrase a date deserves — not the phrase itself.
 *
 * Keeping the choice separate from the wording means this file has no strings to
 * translate and can be unit-tested without a React tree, while the component that
 * renders it calls `t("overdue")` with a literal key that static analysis can see.
 * Passing a translator in here instead hid every key from `eloqnt lint`.
 */
export type DuePhrase =
  | { key: "overdue"; days: number }
  | { key: "wasToday" }
  | { key: "today" }
  | { key: "inDays"; days: number }
  | { key: "on"; date: Date };

export type DonePhrase =
  | { key: "doneToday" }
  | { key: "doneDaysAgo"; days: number }
  | { key: "doneOn"; date: Date };

export function duePhrase(dueAt: string | null, now: Date = new Date()): DuePhrase | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;

  const days = daysBetween(now, due);
  // The day count is always positive: the direction is in the key, and a
  // negative reaching ICU would render "overdue by -3 days".
  if (days < 0) return { key: "overdue", days: -days };
  if (days === 0) return due.getTime() < now.getTime() ? { key: "wasToday" } : { key: "today" };
  if (days <= 7) return { key: "inDays", days };
  return { key: "on", date: due };
}

export function donePhrase(completedAt: string | null, now: Date = new Date()): DonePhrase | null {
  if (!completedAt) return null;
  const done = new Date(completedAt);
  if (Number.isNaN(done.getTime())) return null;

  const days = daysBetween(done, now);
  if (days === 0) return { key: "doneToday" };
  if (days < 7) return { key: "doneDaysAgo", days };
  return { key: "doneOn", date: done };
}
