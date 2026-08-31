---
name: manual-tasks
description: Record what the user has to do by hand — a form in some console, a secret to seed, a promotion to trigger, a review to answer — in the manual-tasks board, instead of burying it in the last message of a session or in a NEXT_STEPS.md. Use it whenever the work you deliver cannot take effect until someone acts somewhere you have no access to, and also to close or correct tasks already recorded when the world changes. Task content is written in the user's own language, which the tools report.
---

# The user's manual tasks

Everything only the user can do lives in one SQLite database, ordered by date and
separated by project. The MCP tools of the `tasks` server are the only way to
write to it.

## When this applies

When what you just delivered **cannot take effect** until someone acts where you
have no access: App Store Connect, Play Console, Firebase, RevenueCat,
Cloudflare, a secret store, a cluster, a reply to a review. Also when a guardrail
you deliberately added is going to block them — a placeholder that fails a build
on purpose, a manual sync.

Do **not** use it for work you could have automated and chose not to. Automate
it, or say plainly why you didn't. A manual task that never needed to exist is
noise in a list the user has to be able to trust.

## The sequence, without skipping steps

### 1. Place yourself

```
where_am_i({ cwd: "<the directory you are in>" })
```

It returns the project, its repositories, which other projects it relates to,
what is pending, and **which language to write task content in**. A project is
**not** a repository: `costia` is five repositories and a single project.

If the path belongs to no project, decide which of two things it is:

- **Another repository of a project that already exists** → `add_project_path`.
  This is the common case and the one most often got wrong: look at the list
  before creating anything.
- **A genuinely new project** → `create_project`, and only then invent its
  identity (see below).

### 2. Read what is already there

```
list_tasks({ project: "...", state: "open", withSteps: true })
```

This is not optional. It is the only defence against recording the same task
three times across three sessions.

### 3. Decide against what exists

| What you find | What you do |
|---|---|
| The task exists and is as it should be | **Nothing.** Leave it alone. "Do nothing" is a correct and frequent outcome. |
| It exists, but the work has grown | `add_steps` with **only** the steps that are missing |
| It exists and you resolved some of it in code | `complete_steps({ by: "agent" })` |
| It exists but its text is no longer true | `update_step`, or `delete_step` if the step is now pointless |
| It exists and no longer applies at all | `update_task({ archived: true })` — archiving keeps the record, deleting destroys it |
| It is new and only the user can do it | `create_task` |
| You could have automated it | Automate it. Do not record it. |

### 4. Show it to them

If you touched anything, call `open_board` and hand over the link with **one
sentence** saying what blocks what. If you touched nothing, say so in one line
and open nothing.

## How to write a step

A step is one action someone can finish in a sitting, in the imperative.

- **The exact value, not a description of it.** `value: "ai.costia.app.pre"`
  rather than "use the pre-production identifier". If they are going to paste it,
  it belongs in `value` or in a code fence — both render with a copy button.
- **`why` when skipping it fails in a way that is not obvious.** Apple issuing a
  different `sub` because an App ID was not grouped; a WAL archive destroying
  point-in-time recovery. If the consequence is self-evident, leave it out. If
  you cannot think what to write there, you probably do not understand the step.
- **`linkUrl` goes to the console, not the documentation.** They are about to do
  the thing, not read about it.
- **Say where it is in the UI, in the product's own words**: "App Store Connect →
  the app → Información general → Acuerdo de licencia" — the product's own
  wording, even where it differs from the task's language. Navigating is most of
  the work.
- **Name the alternatives and pick one.** If there are two paths, say which is
  cheaper and why, instead of listing both neutrally.
- **Phases only for real sequences.** If the steps are independent, do not invent
  an order: pass them as loose `steps`. A fake sequence makes the user wait for
  no reason.
- **What you already resolved is marked, not omitted.** `done: true, doneBy:
  "agent"`. The board labels it as resolved in code, and seeing what is already
  closed is half the context for why the rest is still open.

## Dates

Set `dueAt` only when there is a real date: a review answering a deadline, a
certificate expiring, a deployment window. A task with no date sorts by when it
was created and bothers nobody. **Inventing deadlines empties the "Vencidas"
bucket of meaning**, and that bucket is the first signal the user looks at.

## Tasks across projects

When the same work belongs to several projects, it is **one** task:
`create_task({ project: "a", alsoProjects: ["b"] })`. It appears in both with a
shared state.

When they are different pieces of work and one depends on the other, they are
**two** linked tasks: `link_tasks({ from, to, kind: "blocks" })`. This works
across projects, and it is how "this cannot be done until that is" is expressed.

## A project's identity

Every project has its own visual identity so the user knows where they are
without reading anything. **It is invented once, when the project is created**,
and not touched afterwards unless the user asks.

Choose from the product, not at random: Costia is purple on black; a map of auras
asks for blue and a grid; a training twin asks for soft, light tones. The fields:

- `hue` (0-359): **must be 25° or more away from every other project**; if it is
  not, the tool refuses and tells you where the widest gap is. If you have no
  preference, omit it and one is chosen for you.
- `chroma`: 0.04 muted · 0.13 normal · 0.19 intense.
- `mode`: `dark`, `light` or `auto`.
- `motif`: `none`, `grid`, `dots`, `lines`, `glow`, `noise` — the background texture.
- `fontHeading`: `geometric`, `grotesque`, `serif`, `mono`.
- `radius`: `sharp`, `soft`, `round`.

You cannot break legibility with any of this: the interface's lightness ramp is
fixed and not exposed. Use that headroom and make projects that genuinely differ
— two projects that look alike defeat the purpose.

## Language

`where_am_i` prints one line saying which language to write in — it is a stored
setting, not a guess, and it is the same one the board is showing. Follow it for
everything the user will read: titles, summaries, step bodies, `why`, `value`
labels and phase names. Do not switch language mid-task, and do not translate
tasks that already exist.

If the user asks to change it, `set_locale`. Do not call it on your own initiative:
it is their preference, and it changes the board underneath them.

Code, commits, identifiers and repository documentation stay in **English**
whatever that setting says.

## Keeping it true

A list describing a state of the world that has passed is worse than no list.
When something gets automated, resolved, or stops being necessary, edit it or
close it there and then — do not let the user find out on their own that a step
was a lie.
