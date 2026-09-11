import { describe, expect, test } from "bun:test";

import pkg from "../package.json";
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

  test("the old name is redirected rather than orphaned", () => {
    // Anyone who installed before the rename has "claude-manual-todos-plugin"
    // written into their config; without this they get a plugin that vanished.
    expect(marketplace.renames["claude-manual-todos-plugin"]).toBe(PLUGIN_NAME);
  });
});
