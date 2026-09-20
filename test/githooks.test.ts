import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * The two ways this machinery breaks without saying anything.
 *
 * A hook committed without its execute bit does not run — not on the committer's
 * machine and not on anyone else's — and reports nothing about it. And the
 * grammar the hook enforces is the grammar CI enforces, so a change to one that
 * does not reach the other turns a required check into a coin toss.
 */
describe("the hooks are wired", () => {
  test("every hook is executable in the index, not just on this disk", () => {
    const listed = spawnSync("git", ["ls-files", "-s", ".githooks", "scripts/commit-lint.sh"], {
      encoding: "utf8",
    }).stdout.trim();

    // An empty listing would pass a naive loop while proving nothing.
    expect(listed.length).toBeGreaterThan(0);
    for (const line of listed.split("\n")) {
      expect(line.startsWith("100755"), line).toBe(true);
    }
  });

  test("the hooks call the shared linter rather than carrying their own copy", () => {
    const hook = readFileSync(".githooks/commit-msg", "utf8");
    expect(hook).toContain("scripts/commit-lint.sh");
  });
});

describe("release-please writes where we think it does", () => {
  test("the manifest names the last tagged version", () => {
    // Not the version in package.json: that is where release-please writes to,
    // and this is where it reads from. Seeding it with an untagged version makes
    // the first release pull request propose a number that already exists.
    const manifest = JSON.parse(readFileSync(".release-please-manifest.json", "utf8"));
    const tags = spawnSync("git", ["tag", "--list", "v*"], { encoding: "utf8" })
      .stdout.trim().split("\n").filter(Boolean);
    expect(tags).toContain(`v${manifest["."]}`);
  });

  test("the todos entry is the one it bumps by index", () => {
    // The config updates $.plugins[0].version, because release-please's json
    // updater takes a plain JSONPath and not a filter. This is what makes that
    // index correct rather than lucky.
    const marketplace = JSON.parse(readFileSync(".claude-plugin/marketplace.json", "utf8"));
    const plugin = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));
    expect(marketplace.plugins[0]?.name).toBe(plugin.name);
  });
});
