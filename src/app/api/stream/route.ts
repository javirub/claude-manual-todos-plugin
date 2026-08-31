import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Server-sent events driven by the `db_events` tail.
 *
 * The board and the MCP server are different processes writing the same SQLite
 * file, so Next has no idea when Claude registers a task. Polling the max event
 * id is cheap (one indexed read on a table capped at 500 rows) and means a board
 * left open on a second monitor updates itself while you work.
 */
export function GET(request: Request) {
  const db = getDb();
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const lastId = () =>
    db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM db_events").get<{ id: number }>()?.id ?? 0;

  const stream = new ReadableStream({
    start(controller) {
      let seen = lastId();
      controller.enqueue(encoder.encode(`event: hello\ndata: ${seen}\n\n`));

      timer = setInterval(() => {
        try {
          const current = lastId();
          if (current !== seen) {
            seen = current;
            controller.enqueue(encoder.encode(`event: change\ndata: ${current}\n\n`));
          } else {
            controller.enqueue(encoder.encode(": ping\n\n"));
          }
        } catch {
          clearInterval(timer);
          controller.close();
        }
      }, 1500);

      request.signal.addEventListener("abort", () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
