/**
 * Where a project or a task can be looked at.
 *
 * One module, because the origin is the thing most likely to stop being a
 * constant: today it is the board on loopback, and a hosted board would be a
 * second one. Everything that hands a link to the user or to the agent asks here,
 * so that change lands in one place rather than in six string templates.
 */
import { boardOrigin } from "@/lib/db/paths";

export function boardHome(): string {
  return boardOrigin();
}

export function projectUrl(slug: string): string {
  return `${boardHome()}/p/${slug}`;
}

export function taskUrl(slug: string): string {
  return `${boardHome()}/t/${slug}`;
}
