"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/** Typing filters as you go; the URL is the state, so a filtered view is shareable. */
export function SearchBox({ initial }: { initial: string }) {
  const t = useTranslations("list");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const current = search.get("q") ?? initial;
  const [value, setValue] = useState(current);
  // What the URL last said, so we can tell a change we caused from one we didn't.
  const synced = useRef(current);

  // The URL moved without us — Clear filters, the back button, a rail link. The
  // field follows it instead of typing the old query back in.
  useEffect(() => {
    if (current === synced.current) return;
    synced.current = current;
    setValue(current);
  }, [current]);

  useEffect(() => {
    // Only a query the user actually typed rewrites the URL. Without this guard
    // every navigation re-runs the effect and drops ?task, so picking a task in
    // the list would bounce straight back to the default selection.
    if (value === current) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(search.toString());
      if (value) params.set("q", value);
      else params.delete("q");
      params.delete("task");
      synced.current = value;
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    }, 200);
    return () => clearTimeout(timer);
  }, [value, current, pathname, router, search]);

  return (
    <input
      className="search"
      type="search"
      value={value}
      placeholder={t("searchPlaceholder")}
      onChange={(e) => setValue(e.target.value)}
      aria-label={t("searchLabel")}
    />
  );
}
