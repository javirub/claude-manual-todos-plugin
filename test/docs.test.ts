import { expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

test("the quick start and guides link to existing local documents and images", () => {
  for (const file of ["README.md", "docs/setup.md", "docs/reference.md", "docs/development.md"]) {
    const markdown = readFileSync(file, "utf8");
    for (const match of markdown.matchAll(/]\(([^\s)]+)\)/g)) {
      const target = match[1]!;
      if (/^(https?:|#)/.test(target)) continue;
      const path = resolve(dirname(file), target.split("#")[0]!);
      expect(existsSync(path), `${file}: ${target}`).toBe(true);
      expect(statSync(path).size, `${file}: ${target} must not be empty`).toBeGreaterThan(0);
    }
  }
});
