/**
 * The little bit of git this needs: what a checkout is, and how to make one.
 *
 * Every call here runs with the credential prompts turned off. A prompt would
 * block on a terminal nobody is watching — the MCP server's stdin is a JSON-RPC
 * stream, not a person — and the process would hang until something killed it.
 * A clone that fails because it cannot authenticate is a result we can report;
 * a clone that waits forever is not.
 */
import { spawnSync } from "node:child_process";

import { IS_WINDOWS } from "./runtime";

export function gitExecutable(): string {
  return process.env.CLAUDE_TASKS_GIT || (IS_WINDOWS ? "git.exe" : "git");
}

interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

function git(args: string[], cwd?: string, timeout = 120_000): GitResult {
  const result = spawnSync(gitExecutable(), args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: {
      ...process.env,
      // Never ask. See the note at the top of this file.
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
      SSH_ASKPASS: "",
      GCM_INTERACTIVE: "never",
    },
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim() || result.error?.message || "",
  };
}

export function gitAvailable(): boolean {
  return git(["--version"], undefined, 5_000).status === 0;
}

export interface RepoInfo {
  /** The working tree's root, which is rarely the directory we were handed. */
  toplevel: string;
  remoteUrl: string | null;
  branch: string | null;
}

/** What repository, if any, a directory belongs to. */
export function detectRepo(dir: string): RepoInfo | null {
  const toplevel = git(["-C", dir, "rev-parse", "--show-toplevel"], undefined, 10_000);
  if (toplevel.status !== 0 || !toplevel.stdout) return null;

  const remote = git(["-C", dir, "remote", "get-url", "origin"], undefined, 10_000);
  const branch = git(["-C", dir, "symbolic-ref", "--short", "HEAD"], undefined, 10_000);

  return {
    toplevel: toplevel.stdout,
    remoteUrl: remote.status === 0 && remote.stdout ? remote.stdout : null,
    branch: branch.status === 0 && branch.stdout ? branch.stdout : null,
  };
}

/**
 * One spelling for a repository that has several.
 *
 * The same repository is `git@github.com:a/b.git` on one machine and
 * `https://github.com/a/b` on another, because that is a choice about how you
 * authenticate rather than about which repository you mean. Comparing the raw
 * strings would make importing a project onto a second computer clone everything
 * a second time, next to the checkouts it already had.
 */
export function normaliseRemote(url: string): string {
  let value = url.trim();
  if (!value) return value;

  // scp-like syntax: git@host:owner/repo.git
  const scp = /^(?:([^@/]+)@)?([^:/]+):(?!\/)(.+)$/.exec(value);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `https://${scp[2]}/${scp[3]}`;
  } else {
    value = value.replace(/^(ssh|git|https?):\/\/(?:[^@/]+@)?/i, "https://");
  }

  value = value.replace(/\.git$/i, "").replace(/\/+$/, "");
  return value.toLowerCase();
}

export function sameRemote(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  return normaliseRemote(left) === normaliseRemote(right);
}

export type CloneOutcome = { ok: true } | { ok: false; reason: string };

export function cloneRepo(remote: string, dest: string, branch?: string | null): CloneOutcome {
  const args = ["clone"];
  if (branch) args.push("--branch", branch);
  args.push(remote, dest);

  const result = git(args);
  if (result.status === 0) return { ok: true };

  // git puts everything conversational on stderr, including the failure.
  const reason = result.stderr.split(/\r?\n/).filter(Boolean).pop() || `git clone exited ${result.status}`;
  return { ok: false, reason };
}
