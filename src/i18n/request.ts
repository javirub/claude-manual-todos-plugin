import { getRequestConfig } from "next-intl/server";

import { getDb } from "@/lib/db";
import { getLocale } from "@/lib/db/settings";

/**
 * The locale is not in the URL and not in a cookie: it lives in the same SQLite
 * file as everything else, because it is not only a display preference. The MCP
 * server reads it to know which language to write new tasks in, so a per-browser
 * cookie would let the board and the agent disagree.
 */
export default getRequestConfig(async () => {
  const locale = getLocale(getDb());
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
