"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/lib/db";
import {
  isLocale,
  setLocale,
  setStatuslineOverride,
  type Locale,
} from "@/lib/db/settings";
import { setStepsDone, setTaskDone, updateTask } from "@/lib/db/tasks";

/**
 * The board's writes. They go through the same query layer the MCP server uses,
 * so "the user ticked it" and "Claude closed it" end up in exactly one shape —
 * only `done_by` differs, and that difference is shown rather than smoothed away.
 */

export async function toggleStep(stepId: number, done: boolean): Promise<void> {
  setStepsDone(getDb(), [stepId], done, "user");
  revalidatePath("/", "layout");
}

export async function toggleTask(taskId: number, done: boolean): Promise<void> {
  setTaskDone(getDb(), taskId, done, "user");
  revalidatePath("/", "layout");
}

export async function setTaskDue(taskId: number, dueAt: string | null): Promise<void> {
  updateTask(getDb(), taskId, { dueAt: dueAt || null });
  revalidatePath("/", "layout");
}

export async function setBoardLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  setLocale(getDb(), locale);
  // The whole shell changes language, and the agent reads this setting too.
  revalidatePath("/", "layout");
}

/**
 * Whether this project shows in the Claude Code status bar.
 *
 * Here as well as in the CLI because this is where someone realises they do not
 * want it: looking at a project they check twice a year, wondering why it is in
 * their status bar. `todos statusline off` is the same write from the terminal.
 */
export async function setStatuslineForProject(slug: string, enabled: boolean): Promise<void> {
  setStatuslineOverride(getDb(), slug, enabled);
  revalidatePath("/", "layout");
}
