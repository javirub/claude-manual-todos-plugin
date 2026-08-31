"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/lib/db";
import { isLocale, setLocale, type Locale } from "@/lib/db/settings";
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
