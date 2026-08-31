import type { Locale } from "@/lib/db/settings";
import type messages from "./messages/en.json";

/**
 * Typed messages. English is the reference catalogue, so a key that does not
 * exist — or an ICU argument that is missing or misspelt — is a compile error
 * rather than a blank on screen. `bun run typecheck` is the gate.
 *
 * The locale is not next-intl's routing type here: it comes from the database,
 * so it is the same union the settings module and the MCP tools use.
 */
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
