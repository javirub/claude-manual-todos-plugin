#!/usr/bin/env bun
/**
 * The database the screenshots are taken of.
 *
 * Not the user's. `CLAUDE_TASKS_DB` has to point somewhere disposable before
 * this runs, and it refuses to touch a file that already has projects in it —
 * photographing somebody's real backlog and publishing it in a README is a
 * mistake you only get to make once.
 *
 *   CLAUDE_TASKS_DB=/tmp/demo.db bun scripts/seed-demo.ts
 *
 * Three rules the content follows, all learned from store screenshots that
 * shipped wrong:
 *
 * - **Dates are relative to today.** A hardcoded date empties the Overdue and
 *   This week buckets, which are the two the board leads with.
 * - **Values are real strings.** `ai.costia.training.pre`, not "the identifier".
 *   A screenshot of a task list is read as a claim about what the tool holds,
 *   and "Step 3" reads as an empty demo.
 * - **The shape is uneven.** One overdue, one today, one later, one undated, one
 *   finished; progress at 0/4, 3/6 and 7/8. Flat data hides the bucket headings,
 *   the tick meter and the overdue colour all at once.
 */
import { rmSync } from "node:fs";

import { connect } from "@/lib/db";
import { databasePath } from "@/lib/db/paths";
import { createProject, linkProjects, listProjects } from "@/lib/db/projects";
import { setLocale } from "@/lib/db/settings";
import { createTask, linkTasks } from "@/lib/db/tasks";
import type { Sqlite } from "@/lib/db/driver";

const DAY = 86_400_000;

/**
 * A day, not an instant: `normalizeDue` turns `YYYY-MM-DD` into the last moment
 * of that local day, which is what puts "due today" in the Today bucket instead
 * of in Overdue whenever the capture happens to run after noon.
 */
const inDays = (days: number): string => {
  const d = new Date(Date.now() + days * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function guard(): void {
  const path = databasePath();
  if (!process.env.CLAUDE_TASKS_DB) {
    console.error(
      `Refusing to write to the default database at ${path}.\n` +
        `Point CLAUDE_TASKS_DB at a scratch file first.`,
    );
    process.exit(2);
  }
  const existing = (() => {
    try {
      return listProjects(connect(path)).length;
    } catch {
      return 0;
    }
  })();
  if (existing > 0 && !process.argv.includes("--force")) {
    console.error(`${path} already holds ${existing} projects. Pass --force to wipe and reseed.`);
    process.exit(2);
  }
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
}

function seed(db: Sqlite): Record<string, number> {
  setLocale(db, "en");

  /* ----------------------------------------------------------- projects */

  // Four identities that could not be confused with one another at a glance:
  // different hue, different mode, different texture, different typeface. That
  // is the claim the gallery has to prove, so the demo has to make it true.
  const costia = createProject(db, {
    name: "Costia",
    slug: "costia",
    summary: "Five repositories and one product: the app, the API, accounts, the public docs and the cluster that serves them.",
    paths: [
      { path: "/home/you/code/costia", label: "costia", role: "monorepo" },
      { path: "/home/you/code/costia/backend", label: "backend", role: "api" },
      { path: "/home/you/code/costia/frontend", label: "frontend", role: "app" },
      { path: "/home/you/code/costia/k3s-cluster", label: "k3s-cluster", role: "infra" },
    ],
    owners: [
      { slug: "apple", label: "Apple" },
      { slug: "google", label: "Google Play" },
      { slug: "infisical", label: "Secrets" },
      { slug: "cluster", label: "Cluster" },
    ],
    theme: { hue: 292, chroma: 0.16, neutralChroma: 0.014, mode: "dark", motif: "glow", fontHeading: "geometric", radius: "round" },
  });

  const training = createProject(db, {
    name: "Costia Training",
    slug: "costia-training",
    summary: "The training twin: its own app, its own API, its own cluster.",
    paths: [
      { path: "/home/you/code/costia-training", label: "costia-training", role: "monorepo" },
      { path: "/home/you/code/costia-training/frontend", label: "frontend", role: "app" },
    ],
    owners: [
      { slug: "apple", label: "Apple" },
      { slug: "expo", label: "Expo" },
      { slug: "sentry", label: "Sentry" },
    ],
    theme: { hue: 44, chroma: 0.14, neutralChroma: 0.01, mode: "light", motif: "lines", fontHeading: "grotesque", radius: "sharp" },
  });

  const aura = createProject(db, {
    name: "Aura Map",
    slug: "aura-map",
    summary: "Backend, web, mobile and cluster for the map of auras.",
    paths: [{ path: "/home/you/code/aura-map", label: "aura-map", role: "monorepo" }],
    owners: [
      { slug: "cloudflare", label: "Cloudflare" },
      { slug: "mapbox", label: "Mapbox" },
    ],
    theme: { hue: 212, chroma: 0.13, neutralChroma: 0.012, mode: "dark", motif: "grid", fontHeading: "mono", radius: "soft" },
  });

  const helm = createProject(db, {
    name: "Hospital DevOps",
    slug: "hospital-devops",
    summary: "The Helm charts behind the hospital deployment.",
    paths: [{ path: "/home/you/code/hospital-helm-charts", label: "helm-charts", role: "infra" }],
    owners: [
      { slug: "cluster", label: "Cluster" },
      { slug: "dba", label: "DBA" },
    ],
    theme: { hue: 152, chroma: 0.11, neutralChroma: 0.008, mode: "dark", motif: "dots", fontHeading: "serif", radius: "soft" },
  });

  linkProjects(db, costia.id, training.id, "shares_infra", "Same Apple team, same secret store.");

  /* -------------------------------------------------------------- tasks */

  // Overdue, and the one the board opens on. Deliberately the least glamorous
  // kind of work there is, because that is the kind this tool exists for.
  const agreements = createTask(db, {
    projectId: costia.id,
    title: "Sign the paid applications agreement",
    summary: "Everything else is ready to ship. Until this is signed the build can be reviewed but not released.",
    dueAt: inDays(-3),
    steps: [
      {
        title: "Accept the agreement in App Store Connect",
        body: "App Store Connect → **Business** → Agreements, Tax and Banking.",
        why: "Until it is signed the Release button is greyed out with no explanation next to it, and the build sits in Ready for Sale doing nothing.",
        linkUrl: "https://appstoreconnect.apple.com/business",
        linkLabel: "Agreements, Tax and Banking",
        owner: "apple",
      },
      { title: "Fill in the bank account and the tax forms", owner: "apple" },
      {
        title: "Confirm the legal entity matches the one on the invoice",
        why: "A mismatch is only reported months later, as withheld payouts.",
        owner: "apple",
      },
    ],
  });

  // Due today, mid-progress, and the shot that shows what a step is for: exact
  // values with a copy button, a reason, and a link to the console not the docs.
  const secrets = createTask(db, {
    projectId: costia.id,
    alsoProjectIds: [training.id],
    title: "Rotate the App Store shared secret",
    summary: "One secret, two apps. The receipt validator rejects everything until both sides carry the same value.",
    dueAt: inDays(0),
    phases: [
      {
        name: "Issue",
        note: "Apple shows the new secret exactly once.",
        steps: [
          {
            title: "Generate a new app-specific shared secret",
            body: "App Store Connect → the app → **App Information** → App-Specific Shared Secret.",
            linkUrl: "https://appstoreconnect.apple.com",
            linkLabel: "App Store Connect",
            owner: "apple",
            done: true,
            doneBy: "user",
          },
          {
            title: "Store it before closing the dialog",
            why: "It is shown once. Regenerating it is not free: every client still holding the old one starts failing validation the moment you do.",
            value: "APPLE_SHARED_SECRET",
            owner: "infisical",
            done: true,
            doneBy: "user",
          },
        ],
      },
      {
        name: "Roll out",
        steps: [
          {
            title: "Set it on the production API",
            value: "kubectl -n costia set env deploy/api APPLE_SHARED_SECRET=…",
            owner: "cluster",
            done: true,
            doneBy: "agent",
          },
          { title: "Set it on the training API", value: "kubectl -n costia-training set env deploy/api APPLE_SHARED_SECRET=…", owner: "cluster" },
          {
            title: "Replay one sandbox receipt against both APIs",
            why: "A rotation that only half landed looks identical to one that worked until the first real purchase.",
            owner: "cluster",
          },
          { title: "Delete the old secret from the vault", owner: "infisical" },
        ],
      },
    ],
  });

  // This week, and the one that shows "resolved in code": most of the work was
  // the agent's, and what is left is the part it could not reach.
  const sentry = createTask(db, {
    projectId: training.id,
    title: "Finish turning Sentry on: the source map upload token",
    summary: "The SDK is wired up and releases are tagged. The token is the only piece that has to be minted by hand.",
    dueAt: inDays(3),
    steps: [
      { title: "Install and initialise the SDK", owner: "sentry", done: true, doneBy: "agent" },
      { title: "Tag releases with the build number in CI", owner: "expo", done: true, doneBy: "agent" },
      { title: "Add the upload step to the release workflow", owner: "expo", done: true, doneBy: "agent" },
      {
        title: "Mint an organisation auth token with project:releases",
        body: "Sentry → **Settings** → Auth Tokens → Create New Token.",
        why: "A personal token works until the person leaves, and then stack traces silently go back to being minified.",
        linkUrl: "https://sentry.io/settings/auth-tokens/",
        linkLabel: "Auth Tokens",
        value: "SENTRY_AUTH_TOKEN",
        owner: "sentry",
      },
      { title: "Put it in the CI secrets", owner: "expo" },
      { title: "Push a build and check one stack trace is readable", owner: "sentry" },
    ],
  });

  // Later, and blocked: the relation is the point of this one.
  const release = createTask(db, {
    projectId: costia.id,
    title: "Submit 2.4 for review",
    summary: "The build is uploaded and the listing is written. What is left is the submission itself.",
    dueAt: inDays(9),
    steps: [
      { title: "Attach build 2.4 (118) to the version", value: "2.4 (118)", owner: "apple" },
      {
        title: "Answer the export compliance questions",
        why: "Answering yes to encryption without a matching exemption sends the build to a separate review queue that takes a week longer.",
        owner: "apple",
      },
      { title: "Paste the release notes for both languages", owner: "apple" },
      {
        title: "Set the release to manual, not automatic",
        why: "Automatic release ships the moment review passes, which is usually a Saturday.",
        owner: "apple",
      },
      { title: "Submit for review", owner: "apple" },
      { title: "Turn the Play Store staged rollout up to 100% once Apple approves", value: "100", owner: "google" },
    ],
  });

  // Undated, because most work has no real deadline and inventing one would
  // empty the Overdue bucket of meaning.
  const dns = createTask(db, {
    projectId: aura.id,
    title: "Move the apex record to the new load balancer",
    summary: "The cluster answers on the new address already; the record still points at the old one.",
    steps: [
      { title: "Lower the TTL to 300 and wait for the old one to expire", value: "300", owner: "cloudflare" },
      {
        title: "Point the apex A record at the new address",
        value: "203.0.113.42",
        why: "Cloudflare will not proxy an apex CNAME, so this has to be the address rather than a name that follows it.",
        linkUrl: "https://dash.cloudflare.com",
        linkLabel: "Cloudflare DNS",
        owner: "cloudflare",
      },
      { title: "Put the TTL back to an hour", value: "3600", owner: "cloudflare" },
    ],
  });

  createTask(db, {
    projectId: helm.id,
    title: "Approve the database maintenance window",
    summary: "The upgrade needs a fifteen-minute window someone has to sign off on.",
    dueAt: inDays(5),
    steps: [
      { title: "Pick a window with the ward that uses it most", owner: "dba" },
      {
        title: "Take a base backup immediately before it",
        why: "The upgrade rewrites the WAL, and a point-in-time recovery from before it stops being possible the moment it starts.",
        owner: "dba",
      },
      { title: "Announce it on the status page", owner: "cluster" },
    ],
  });

  // One finished, so the Completed bucket is not empty in the screenshots.
  createTask(db, {
    projectId: aura.id,
    title: "Raise the Mapbox tile quota",
    summary: "The free tier ran out three days into the beta.",
    dueAt: inDays(-9),
    steps: [
      { title: "Add a payment method", owner: "mapbox", done: true, doneBy: "user" },
      { title: "Raise the monthly tile cap to 200k", value: "200000", owner: "mapbox", done: true, doneBy: "user" },
      { title: "Set an alert at 80%", owner: "mapbox", done: true, doneBy: "user" },
    ],
  });

  linkTasks(db, agreements.id, release.id, "blocks");
  linkTasks(db, secrets.id, release.id, "relates");
  linkTasks(db, sentry.id, release.id, "relates");

  return { agreements: agreements.id, secrets: secrets.id, sentry: sentry.id, release: release.id, dns: dns.id };
}

guard();
const db = connect();
seed(db);

/**
 * Counted from the database rather than from the literals above: a write the
 * schema quietly refused looks identical from up there, and the capture would
 * be of an empty board that nothing complained about.
 */
const wrote = {
  projects: db.prepare("SELECT COUNT(*) AS n FROM projects").get<{ n: number }>()!.n,
  tasks: db.prepare("SELECT COUNT(*) AS n FROM tasks").get<{ n: number }>()!.n,
  steps: db.prepare("SELECT COUNT(*) AS n FROM steps").get<{ n: number }>()!.n,
  done: db.prepare("SELECT COUNT(*) AS n FROM steps WHERE done_at IS NOT NULL").get<{ n: number }>()!.n,
};

if (wrote.projects < 4 || wrote.tasks < 7 || wrote.steps < 20) {
  console.error(`Only ${JSON.stringify(wrote)} landed. Something refused a write.`);
  process.exit(1);
}

console.log(`Seeded ${databasePath()}: ${JSON.stringify(wrote)}`);
