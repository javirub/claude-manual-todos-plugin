/**
 * The token for the hosted service, and where it is kept.
 *
 * A file in the state directory, mode 0600 — deliberately not the SQLite
 * database. That file is documented as portable, people copy it between
 * machines, and `CLAUDE_TASKS_DB` can point it anywhere; a bearer token has no
 * business travelling with your task list.
 *
 * `TODOS_TOKEN` overrides everything, for CI and for anyone who would rather
 * keep the secret in their own vault and hand it over per invocation.
 */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { stateDir } from "@/lib/db/paths";
import { atomicWrite } from "@/lib/fs";

export interface Credentials {
  api: string;
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. Renewed well before this, not after it. */
  expiresAt: number;
}

function credentialsPath(): string {
  return join(stateDir(), "credentials.json");
}

export function readCredentials(): Credentials | null {
  const token = process.env.TODOS_TOKEN;
  if (token) {
    return {
      api: process.env.TODOS_API || "",
      accessToken: token,
      refreshToken: null,
      // Supplied from outside, so its lifetime is not ours to know or manage.
      expiresAt: Number.MAX_SAFE_INTEGER,
    };
  }
  try {
    const value = JSON.parse(readFileSync(credentialsPath(), "utf8"));
    if (typeof value.accessToken !== "string") return null;
    return {
      api: String(value.api ?? ""),
      accessToken: value.accessToken,
      refreshToken: typeof value.refreshToken === "string" ? value.refreshToken : null,
      expiresAt: Number(value.expiresAt) || 0,
    };
  } catch {
    return null;
  }
}

export function writeCredentials(credentials: Credentials): void {
  atomicWrite(credentialsPath(), JSON.stringify(credentials, null, 2) + "\n", 0o600);
}

export function clearCredentials(): void {
  try {
    unlinkSync(credentialsPath());
  } catch {
    /* Logging out of a session that was never started is not a failure. */
  }
}

export function hasCredentials(): boolean {
  return !!process.env.TODOS_TOKEN || existsSync(credentialsPath());
}
