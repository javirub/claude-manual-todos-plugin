import type { Sqlite } from "./driver";

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language named in itself, which is how a language picker should read. */
export const LOCALE_LABELS: Record<Locale, string> = { en: "English", es: "Español" };

export function isLocale(value: string | undefined | null): value is Locale {
  return LOCALES.includes(value as Locale);
}

export function getSetting(db: Sqlite, key: string): string | null {
  return db.prepare("SELECT value FROM settings WHERE key = ?").get<{ value: string }>(key)?.value ?? null;
}

export function setSetting(db: Sqlite, key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

/**
 * The first guess comes from the environment, because someone whose shell is
 * `es_ES.UTF-8` should not have to go and say so. It is only a default: once the
 * locale is stored, the environment stops mattering, so a board opened from a
 * different shell does not change language underneath the user.
 */
export function detectLocale(env: Record<string, string | undefined> = process.env): Locale {
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || env.LANGUAGE || "";
  const tag = raw.split(/[.:_-]/)[0]?.toLowerCase();
  return isLocale(tag) ? tag : DEFAULT_LOCALE;
}

export function getLocale(db: Sqlite): Locale {
  const stored = getSetting(db, "locale");
  if (isLocale(stored)) return stored;
  const detected = detectLocale();
  setSetting(db, "locale", detected);
  return detected;
}

export function setLocale(db: Sqlite, locale: Locale): Locale {
  setSetting(db, "locale", locale);
  return locale;
}
