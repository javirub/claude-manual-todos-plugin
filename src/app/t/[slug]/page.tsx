import { notFound, redirect } from "next/navigation";

import { getDb } from "@/lib/db";
import { getTask } from "@/lib/db/tasks";

export const dynamic = "force-dynamic";

/**
 * The stable link the MCP server hands out. It resolves to the task inside its
 * own project, so following it lands you in that project's colours.
 */
export default async function TaskPermalink({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const task = getTask(getDb(), slug);
  if (!task) notFound();

  const primary = task.projects.find((p) => p.isPrimary) ?? task.projects[0];
  redirect(primary ? `/p/${primary.slug}?task=${task.slug}` : `/?task=${task.slug}`);
}
