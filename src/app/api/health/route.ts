import { PLUGIN_NAME, PLUGIN_VERSION } from "@/lib/manifest";

export const dynamic = "force-dynamic";

/** The CLI polls this to decide whether it needs to start a server. */
export function GET() {
  return Response.json({ ok: true, service: PLUGIN_NAME, version: PLUGIN_VERSION });
}
