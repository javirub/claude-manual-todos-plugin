import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// The board is a single-user tool served on localhost. Nothing here is cached
// across requests: the source of truth is a SQLite file that another process
// (the MCP server) writes to behind Next's back.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
};

// The locale comes from the database rather than the URL, so there is no
// routing setup here — only the request config the plugin points at.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
