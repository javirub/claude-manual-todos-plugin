/**
 * Date logic only — no words. Everything the user reads about a date is produced
 * by next-intl from `messages/*.json`; everything the agent reads is produced in
 * English by `./text.ts`. Both call in here for the arithmetic.
 */
export type DueBucket = "overdue" | "today" | "week" | "later" | "none";

export const BUCKET_ORDER: readonly DueBucket[] = ["overdue", "today", "week", "later", "none"];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysBetween(from: Date, to: Date): number {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Buckets are computed in local time, because a deadline is a day in the user's
 * life, not an instant on a clock.
 */
export function bucketOf(dueAt: string | null, now: Date = new Date()): DueBucket {
  if (!dueAt) return "none";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "none";
  if (due.getTime() < now.getTime()) return "overdue";
  const days = daysBetween(now, due);
  if (days === 0) return "today";
  if (days <= 7) return "week";
  return "later";
}
