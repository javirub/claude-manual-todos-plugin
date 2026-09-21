#!/usr/bin/env bash
# The one definition of what a commit may say.
#
# Three things read this file: the commit-msg hook, the pull request title check
# in CI, and the same check on GitLab. Squash merge means the pull request title
# is the message that lands on main, so the hook is the rehearsal and CI is the
# gate — and they must not be able to disagree about the grammar.
#
# Bash rather than Bun, so the backend can carry a literal copy: it has a JVM and
# no Bun, and two repositories on two hosts cannot share a dependency.
#
# Usage: commit-lint.sh <file>   or   commit-lint.sh -   (message on stdin)
set -euo pipefail

[ $# -eq 1 ] || { echo "usage: commit-lint.sh <file|->" >&2; exit 2; }
if [ "$1" = "-" ]; then message=$(cat); else message=$(cat -- "$1"); fi

# Comment lines are git's, not the author's. Strip CR so a Windows checkout does
# not fail on an invisible character.
message=$(printf '%s\n' "$message" | sed -e 's/\r$//' -e '/^#/d')
header=$(printf '%s\n' "$message" | sed -n '1p')

# Git writes these itself, and a rule that rejects what git produces is a rule
# nobody can keep.
case "$header" in
  "Merge "*|"Revert "*|"fixup! "*|"squash! "*|"amend! "*|"") exit 0 ;;
esac

types='build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test'
bad=0
note() { printf '  %s\n' "$*" >&2; }
fail() { bad=1; note "$@"; }

if ! printf '%s' "$header" | grep -Eq "^(${types})(\([a-z0-9][a-z0-9._-]*\))?!?: .+$"; then
  fail "not a conventional commit header."
  note "expected: <type>(<scope>)!: <subject>"
  note "types:    ${types//|/, }"
fi

subject=${header#*: }
[ "${#header}" -le 100 ] || fail "the header is ${#header} characters; 100 is the hard limit."
case "$subject" in
  *.) fail "the subject ends in a full stop." ;;
esac

# Absolute, everywhere in this estate. A commit-msg hook is the only place where
# catching it still costs nothing.
if printf '%s\n' "$message" | grep -qiE '^[[:space:]]*co-authored-by:.*(claude|anthropic)'; then
  fail "Co-Authored-By: Claude. Never, in any repository here."
fi
if printf '%s\n' "$message" | grep -qiE 'generated with .*(claude|anthropic)'; then
  fail "a Claude attribution line. Never, in any repository here."
fi

# Advice, not law: the house subject is descriptive prose, not an imperative.
# Bots are exempt — their titles are not ours to style.
case "$header" in
  "chore(deps"*|"chore(main): release "*) ;;
  *)
    if printf '%s' "$subject" | grep -Eqi '^(add|update|fix|remove|delete|create|make|implement|improve|bump|refactor|introduce) '; then
      note "note: \"${subject}\" reads as an instruction. The house style is what the"
      note "      change *is*: \"feat(todos): the API and its database, both manual\"."
    fi
    [ "${#header}" -le 72 ] || note "note: ${#header} characters. Under 72 reads better in a log."
    ;;
esac

if [ "$bad" -ne 0 ]; then
  printf '\n%s\n' "Rejected: ${header}" >&2
  printf '%s\n' "Nothing was committed. Your message is in .git/COMMIT_EDITMSG:" >&2
  printf '%s\n' "  git commit -e -F .git/COMMIT_EDITMSG" >&2
  exit 1
fi
