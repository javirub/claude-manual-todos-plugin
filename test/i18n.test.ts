import { describe, expect, test } from "bun:test";

import { connect } from "@/lib/db";
import { detectLocale, getLocale, setLocale } from "@/lib/db/settings";
import { donePhrase, duePhrase } from "@/lib/format/due";

/**
 * Catalogue health — missing translations, ICU arguments that disagree between
 * locales, keys nobody uses — is checked by `bun run lint:messages` (eloqnt), and
 * wrong keys are a compile error thanks to the augmentation in global.d.ts. What
 * is left for here is the logic those two cannot see.
 */

describe("the stored locale", () => {
  test("falls back to the environment on first read, then stays put", () => {
    const db = connect(":memory:");
    expect(getLocale(db)).toBe(detectLocale());

    setLocale(db, "en");
    expect(getLocale(db)).toBe("en");
    setLocale(db, "es");
    // Reading again must not re-detect: a board opened from a different shell
    // would otherwise change language underneath the user.
    expect(getLocale(db)).toBe("es");
  });

  test("reads a POSIX locale string, and ignores one it has no catalogue for", () => {
    expect(detectLocale({ LANG: "es_ES.UTF-8" })).toBe("es");
    expect(detectLocale({ LC_ALL: "en_GB.UTF-8", LANG: "es_ES.UTF-8" })).toBe("en");
    expect(detectLocale({ LANG: "fr_FR.UTF-8" })).toBe("en");
    expect(detectLocale({})).toBe("en");
  });
});

describe("choosing the phrase for a date", () => {
  const now = new Date("2026-08-31T10:00:00");

  test("past, today, soon and far each pick their own message", () => {
    expect(duePhrase("2026-08-28T21:59:59", now)).toEqual({ key: "overdue", days: 3 });
    expect(duePhrase("2026-08-31T09:00:00", now)).toEqual({ key: "wasToday" });
    expect(duePhrase("2026-08-31T23:00:00", now)).toEqual({ key: "today" });
    expect(duePhrase("2026-09-01T23:00:00", now)).toEqual({ key: "inDays", days: 1 });
    expect(duePhrase("2026-09-04T21:59:59", now)).toEqual({ key: "inDays", days: 4 });
    expect(duePhrase("2026-12-01T21:59:59", now)?.key).toBe("on");
  });

  test("the day count is always positive", () => {
    // The direction lives in the key. A negative reaching ICU would render
    // "overdue by -3 days".
    const phrase = duePhrase("2026-08-20T21:59:59", now);
    expect(phrase).toEqual({ key: "overdue", days: 11 });
  });

  test("a single day either way leans on the plural's `one` branch", () => {
    // There is no separate "tomorrow"/"yesterday" key: ICU covers it, and a
    // second key would be one more thing to keep in sync per language.
    expect(duePhrase("2026-09-01T23:00:00", now)).toEqual({ key: "inDays", days: 1 });
    expect(donePhrase("2026-08-30T08:00:00", now)).toEqual({ key: "doneDaysAgo", days: 1 });
  });

  test("completion is described relative to now", () => {
    expect(donePhrase("2026-08-31T08:00:00", now)).toEqual({ key: "doneToday" });
    expect(donePhrase("2026-08-28T08:00:00", now)).toEqual({ key: "doneDaysAgo", days: 3 });
    expect(donePhrase("2026-07-01T08:00:00", now)?.key).toBe("doneOn");
  });

  test("nothing and nonsense both come back empty", () => {
    expect(duePhrase(null, now)).toBeNull();
    expect(duePhrase("not a date", now)).toBeNull();
    expect(donePhrase(null, now)).toBeNull();
  });
});
