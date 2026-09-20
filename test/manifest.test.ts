import { describe, expect, test } from "bun:test";

import { existsSync, readFileSync } from "node:fs";

import pkg from "../package.json";
import plugin from "../.claude-plugin/plugin.json";
import marketplace from "../.claude-plugin/marketplace.json";
import { PLUGIN_NAME, PLUGIN_VERSION } from "@/lib/manifest";

/**
 * Three files name this plugin and two of them name its version. They drifted
 * apart once already — 0.1.1 in the manifest, 0.1.0 in package.json and a third
 * 0.1.0 hardcoded in the MCP handshake — and nothing noticed, because nothing
 * looked. This looks.
 */
describe("the manifests agree", () => {
  test("package.json carries the manifest's version", () => {
    expect(pkg.version).toBe(PLUGIN_VERSION);
  });

  test("package.json carries the manifest's name", () => {
    expect(pkg.name).toBe(PLUGIN_NAME);
  });

  test("the marketplace lists this plugin, at this version", () => {
    const entry = marketplace.plugins.find((p) => p.name === PLUGIN_NAME);
    expect(entry).toBeDefined();
    expect(entry?.version).toBe(PLUGIN_VERSION);
  });

  test("all three name the same licence", () => {
    // A licence that disagrees with itself across the files a user might read is
    // worse than no licence statement at all, and this one is about to matter.
    expect(pkg.license).toBe("BUSL-1.1");
    expect(plugin.license).toBe(pkg.license);
    expect(marketplace.plugins.find((p) => p.name === PLUGIN_NAME)?.license).toBe(pkg.license);
  });

  test("the MIT releases are still shipped with their terms", () => {
    // Those grants cannot be withdrawn, so the text stays in the tree and the
    // new licence points at it.
    expect(existsSync("LICENSE-MIT")).toBe(true);
    expect(readFileSync("LICENSE", "utf8")).toContain("LICENSE-MIT");
  });

  test("the old name is redirected rather than orphaned", () => {
    // Anyone who installed before the rename has "claude-manual-todos-plugin"
    // written into their config; without this they get a plugin that vanished.
    expect(marketplace.renames["claude-manual-todos-plugin"]).toBe(PLUGIN_NAME);
  });
});
