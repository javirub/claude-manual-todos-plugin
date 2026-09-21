"use server";

import { revalidatePath } from "next/cache";

import { getLocalState, getStore } from "@/lib/core";
import { isLocale, type Locale } from "@/lib/db/settings";

/**
 * The board's writes. They go through the same query layer the MCP server uses,
 * so "the user ticked it" and "Claude closed it" end up in exactly one shape —
 * only `done_by` differs, and that difference is shown rather than smoothed away.
 */

export async function toggleStep(stepId: string, done: boolean): Promise<void> {
  await getStore().setStepsDone([stepId], done, "user");
  revalidatePath("/", "layout");
}

export async function toggleTask(taskId: string, done: boolean): Promise<void> {
  await getStore().setTaskDone(taskId, done, "user");
  revalidatePath("/", "layout");
}

export async function setTaskDue(taskId: string, dueAt: string | null): Promise<void> {
  await getStore().updateTask(taskId, { dueAt: dueAt || null });
  revalidatePath("/", "layout");
}

export async function setBoardLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  await getStore().setLocale(locale);
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
  // Machine state, never the store: which terminal shows what is not a fact
  // about the project, and in cloud mode there is no status bar to speak of.
  getLocalState().setStatuslineOverride(slug, enabled);
  revalidatePath("/", "layout");
}
