import { defineConfig } from "@eloqnt/cli";

/**
 * Catalogue linting for next-intl: missing translations, ICU arguments that
 * disagree between locales, keys nobody uses. English is the source, so a new
 * string lands there first and Spanish is reported as missing until it follows.
 */
export default defineConfig({
  srcPath: "./src",
  messages: {
    path: "./messages",
    locales: "infer",
    sourceLocale: "en",
    format: "json",
  },
});
