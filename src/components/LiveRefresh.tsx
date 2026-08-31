"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps a board that is left open honest. Claude writes to SQLite from another
 * process, which Next cannot know about, so the server tells us when the event
 * tail moves and we re-render from the server.
 */
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const source = new EventSource("/api/stream");
    const onChange = () => router.refresh();
    source.addEventListener("change", onChange);
    return () => {
      source.removeEventListener("change", onChange);
      source.close();
    };
  }, [router]);

  return null;
}
