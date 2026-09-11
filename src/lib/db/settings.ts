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

/* ------------------------------------------------------------- statusline */

/**
 * Whether the statusline segment shows, per project and in general.
 *
 * Two keys rather than one so the two questions stay independent: `statusline`
 * is the default for every project, `statusline.project.<slug>` is one project
 * disagreeing with it. Someone who wants the segment everywhere except the
 * repository they are paid to stare at should not have to enumerate the rest.
 *
 * On by default. A statusline nobody asked for is still only one short segment,
 * and the alternative — shipping it off and hoping the README is read — is how
 * a feature stays undiscovered.
 */
const STATUSLINE_DEFAULT_KEY = "statusline";

function statuslineProjectKey(slug: string): string {
  return `statusline.project.${slug}`;
}

export function getStatuslineDefault(db: Sqlite): boolean {
  return getSetting(db, STATUSLINE_DEFAULT_KEY) !== "off";
}

export function setStatuslineDefault(db: Sqlite, enabled: boolean): void {
  setSetting(db, STATUSLINE_DEFAULT_KEY, enabled ? "on" : "off");
}

/** `null` when the project has no opinion and inherits the default. */
export function getStatuslineOverride(db: Sqlite, slug: string): boolean | null {
  const stored = getSetting(db, statuslineProjectKey(slug));
  if (stored === "on") return true;
  if (stored === "off") return false;
  return null;
}

export function setStatuslineOverride(db: Sqlite, slug: string, enabled: boolean | null): void {
  if (enabled === null) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(statuslineProjectKey(slug));
    return;
  }
  setSetting(db, statuslineProjectKey(slug), enabled ? "on" : "off");
}

/** What the statusline script actually asks: does this project show or not? */
export function statuslineEnabledFor(db: Sqlite, slug: string): boolean {
  return getStatuslineOverride(db, slug) ?? getStatuslineDefault(db);
}
