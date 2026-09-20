/**
 * Which store this process talks to, and how anything gets hold of it.
 *
 * Switching modes changes which workspace you are looking at; it never merges
 * anything. The local database is left exactly as it was, and going back to it
 * shows it exactly as it was left — that property is worth more than any amount
 * of reconciliation logic, and it is the reason there is none.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { refreshAccessToken } from "@/lib/auth";
import { readCredentials } from "@/lib/credentials";
import { getDb } from "@/lib/db";
import { getSetting } from "@/lib/db/settings";

import { LocalState } from "./local-state";
import { LocalTaskStore } from "./local";
import { createRemoteStore } from "./remote";
import type { TaskStore } from "./port";

export type Mode = "local" | "cloud";

export function currentMode(): Mode {
  const override = process.env.CLAUDE_TASKS_MODE;
  if (override === "local" || override === "cloud") return override;
  // Cloud needs both the intent and the credentials. Having only the setting is
  // how someone who logged out ends up with every command failing on a token
  // that is not there, instead of quietly working against their own file.
  if (getSetting(getDb(), "mode") !== "cloud") return "local";
  return readCredentials() ? "cloud" : "local";
}

/**
 * A store bound to the work in hand rather than to the process.
 *
 * The board is a single-user tool on loopback, and a process-wide store is the
 * right shape for that. Served to more than one person it is exactly the wrong
 * shape — whoever asked last would decide what everyone sees — so anything that
 * handles several callers binds a store per request here and the rest of the
 * code carries on asking `getStore()` without knowing the difference.
 */
const scoped = new AsyncLocalStorage<TaskStore>();

export function withStore<T>(bound: TaskStore, run: () => T): T {
  return scoped.run(bound, run);
}

let store: TaskStore | null = null;

export function getStore(): TaskStore {
  const bound = scoped.getStore();
  if (bound) return bound;
  if (store) return store;
  if (currentMode() === "cloud") {
    const credentials = readCredentials()!;
    store = createRemoteStore({
      api: credentials.api || getSetting(getDb(), "cloud.api") || "",
      workspace: getSetting(getDb(), "cloud.workspace") ?? "",
      token: credentials.accessToken,
      refresh: async () => (await refreshAccessToken(readCredentials()!))?.accessToken ?? null,
    });
  } else {
    store = new LocalTaskStore();
  }
  return store;
}

let state: LocalState | null = null;

export function getLocalState(): LocalState {
  if (!state) state = new LocalState();
  return state;
}

/** Only for tests, which build their own stores against an in-memory database. */
export function resetStore(): void {
  store = null;
  state = null;
}

export { LocalTaskStore } from "./local";
export { LocalState } from "./local-state";
export type { TaskStore } from "./port";
export * from "./types";
