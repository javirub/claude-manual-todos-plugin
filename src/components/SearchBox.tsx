"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/** Typing filters as you go; the URL is the state, so a filtered view is shareable. */
export function SearchBox({ initial }: { initial: string }) {
  const t = useTranslations("list");
  const [value, setValue] = useState(initial);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams(search.toString());
      if (value) params.set("q", value);
      else params.delete("q");
      params.delete("task");
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    }, 200);
    return () => clearTimeout(timer);
  }, [value, pathname, router, search]);

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
