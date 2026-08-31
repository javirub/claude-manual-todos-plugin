import { resolve, sep } from "node:path";

import { describe, expect, test } from "bun:test";

import { boardOrigin, boardPort, databasePath, isWithin, stateDir } from "@/lib/db/paths";

describe("is one path inside another", () => {
  test("a directory contains itself and everything under it", () => {
    expect(isWithin("fixtures/costia", "fixtures/costia")).toBe(true);
    expect(isWithin("fixtures/costia", "fixtures/costia/backend")).toBe(true);
    expect(isWithin("fixtures/costia", "fixtures/costia/backend/src/main")).toBe(true);
  });

  test("a sibling that merely starts with the same letters is not inside", () => {
    // The bug a string prefix test would have: "costia-training" starts with
    // "costia", and the two are different projects.
    expect(isWithin("fixtures/costia", "fixtures/costia-training")).toBe(false);
    expect(isWithin("fixtures/costia", "fixtures/costiafoo")).toBe(false);
  });

  test("a parent is not inside its child, and strangers are not inside anything", () => {
    expect(isWithin("fixtures/costia/backend", "fixtures/costia")).toBe(false);
    expect(isWithin("fixtures/costia", "fixtures/aura-map")).toBe(false);
  });

  test("relative and absolute forms of the same place agree", () => {
    // Whatever form a path was registered in, the cwd arrives absolute.
    expect(isWithin("fixtures/costia", resolve("fixtures/costia/backend"))).toBe(true);
    expect(isWithin(resolve("fixtures/costia"), "fixtures/costia/backend")).toBe(true);
  });

  test("trailing separators and redundant segments do not change the answer", () => {
    expect(isWithin(`fixtures/costia${sep}`, "fixtures/costia/backend")).toBe(true);
    expect(isWithin("fixtures/costia", "fixtures/costia/./backend")).toBe(true);
    expect(isWithin("fixtures/costia", "fixtures/costia/backend/..")).toBe(true);
    expect(isWithin("fixtures/costia", "fixtures/costia/../costia-training")).toBe(false);
  });

  test("the comparison uses the platform's own separator", () => {
    // On Windows `resolve` returns backslashes, so anything that splices "/" in
    // by hand matches nothing at all. This passes on every platform precisely
    // because it never mentions a separator.
    const base = resolve("fixtures", "costia");
    const child = resolve("fixtures", "costia", "backend");
    expect(child.startsWith(base)).toBe(true);
    expect(isWithin(base, child)).toBe(true);
  });
});

describe("where things live", () => {
  test("the database is overridable, and otherwise sits outside the repo", () => {
    const previous = process.env.CLAUDE_TASKS_DB;
    process.env.CLAUDE_TASKS_DB = resolve("scratch.db");
    expect(databasePath()).toBe(resolve("scratch.db"));

    delete process.env.CLAUDE_TASKS_DB;
    const fallback = databasePath();
    expect(fallback.endsWith(`claude-tasks${sep}tasks.db`)).toBe(true);
    expect(isWithin(process.cwd(), fallback)).toBe(false);

    if (previous === undefined) delete process.env.CLAUDE_TASKS_DB;
    else process.env.CLAUDE_TASKS_DB = previous;
  });

  test("state sits beside it, not in it", () => {
    expect(stateDir().endsWith("claude-tasks")).toBe(true);
  });

  test("the port is overridable and never NaN", () => {
    const previous = process.env.CLAUDE_TASKS_PORT;

    delete process.env.CLAUDE_TASKS_PORT;
    expect(boardPort()).toBe(4477);

    process.env.CLAUDE_TASKS_PORT = "5000";
    expect(boardPort()).toBe(5000);
    expect(boardOrigin()).toBe("http://127.0.0.1:5000");

    // A typo must not turn the origin into "http://127.0.0.1:NaN".
    process.env.CLAUDE_TASKS_PORT = "not a port";
    expect(boardPort()).toBe(4477);

    if (previous === undefined) delete process.env.CLAUDE_TASKS_PORT;
    else process.env.CLAUDE_TASKS_PORT = previous;
  });
});

describe("the board is not exposed to the network", () => {
  test("dev and start both pin the hostname to loopback", async () => {
    // Next binds every interface by default. This board holds the exact values
    // and console links for someone's pending work and authenticates nobody, so
    // on a shared network the default would hand it to the room — and let them
    // tick steps off. Verified by hand once; this keeps it from drifting back.
    const pkg = await Bun.file("package.json").json();
    expect(pkg.scripts.dev).toContain("-H 127.0.0.1");
    expect(pkg.scripts.start).toContain("-H 127.0.0.1");
  });
});
