#!/usr/bin/env bun
/**
 * The pictures in the README.
 *
 * Seeds a throwaway database, brings the board up on it, captures four screens
 * and composes each one into a framed PNG. Nothing here touches the real
 * database or the board the user may have open: its own port, its own file, its
 * own PID.
 *
 *   bun run shots                 # everything
 *   bun run shots -- --skip-build # reuse .next
 *   bun run shots -- --keep       # leave the board up to look at it yourself
 *
 * Two things this is strict about, both learned the hard way elsewhere:
 *
 * - **Every shot has an anchor.** Without one, a capture of a page that
 *   responded and a capture of the page that rendered are the same green run,
 *   and the README ends up showing a loading state.
 * - **The output directory is wiped.** A shot that stops being generated has to
 *   stop existing, or it is not a build artefact, it is a drawer.
 *
 * The frame is composed in the browser, on the board's own origin, rather than
 * with an image library: the caption is type, and it has to be the board's
 * typeface with real kerning. Loading the page first means `next/font` has
 * already self-hosted and declared all five faces, so the frame just asks for
 * `var(--font-geometric)` and gets it.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "playwright-core";

import { connect } from "@/lib/db";
import { getProject } from "@/lib/db/projects";
import type { ProjectTheme } from "@/lib/db/types";
import { NEUTRAL_THEME, themeStyleSheet } from "@/lib/theme/tokens";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "media");
const DB = join(ROOT, ".next", "cache", "shots-demo.db");
const PORT = Number(process.env.SHOTS_PORT ?? 4479);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const skipBuild = process.argv.includes("--skip-build");
const keep = process.argv.includes("--keep");

/** The board at the width where all three panes are on screen. */
const VIEWPORT = { width: 1440, height: 900 };
/** The finished picture. 3:2, which is what a README renders without letterboxing. */
const FRAME = { width: 2160, height: 1440 };

interface Shot {
  name: string;
  path: string;
  /** The project whose identity the frame wears; `null` for the neutral one. */
  project: string | null;
  /** Text that only exists once the screen has actually rendered. */
  anchor: string;
  caption: string;
  lede: string;
}

const SHOTS: Shot[] = [
  {
    name: "overview",
    path: "/?task=sign-the-paid-applications-agreement",
    project: null,
    anchor: "Sign the paid applications agreement",
    caption: "Everything only you\ncan do, in one place",
    lede: "Across every project, ordered by what is already late",
  },
  {
    name: "steps",
    path: "/p/costia?task=rotate-the-app-store-shared-secret",
    project: "costia",
    anchor: "APPLE_SHARED_SECRET",
    caption: "Exact values, not\ndescriptions of them",
    lede: "Every string you have to paste, with the console it goes into",
  },
  {
    name: "identity",
    path: "/p/costia-training?task=finish-turning-sentry-on-the-source-map-upload-token",
    project: "costia-training",
    anchor: "resolved in code",
    caption: "Every project\nlooks like itself",
    lede: "One palette per project, derived in OKLCH and contrast-checked",
  },
  {
    name: "blocked",
    path: "/p/costia?task=submit-2-4-for-review",
    project: "costia",
    anchor: "blocked by",
    caption: "And what is waiting\non what",
    lede: "Links across projects, so the order to do things in is visible",
  },
];

/* ------------------------------------------------------------------ frame */

function frameHtml(shot: Shot, capture: string): string {
  // Everything derives from the frame size, so changing it does not require
  // re-tuning nine numbers by eye.
  const padX = Math.round(FRAME.width * 0.062);
  const padTop = Math.round(FRAME.height * 0.072);
  const fontSize = Math.round(FRAME.width * 0.043);
  const ledeSize = Math.round(FRAME.width * 0.0145);
  const ruleW = Math.round(FRAME.width * 0.05);
  const ruleH = Math.max(3, Math.round(FRAME.height * 0.0035));
  const shotW = FRAME.width - padX * 2;
  const chromeH = Math.round(FRAME.height * 0.034);

  return `
<div class="frame">
  <h1>${shot.caption.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</h1>
  <div class="rule"></div>
  <p class="lede">${shot.lede.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>
  <div class="window">
    <div class="chrome">
      <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
      <span class="addr">127.0.0.1:4477${shot.path.split("?")[0]}</span>
    </div>
    <img src="${capture}" alt="">
  </div>
</div>
<style>
  html, body { margin: 0; padding: 0; }
  body {
    width: ${FRAME.width}px; height: ${FRAME.height}px; overflow: hidden;
    background: var(--bg);
    background-image: var(--motif-image); background-size: var(--motif-size);
  }
  .frame {
    width: 100%; height: 100%; box-sizing: border-box;
    padding: ${padTop}px ${padX}px 0;
    display: flex; flex-direction: column; align-items: center;
    /* A second wash of the accent, so the ground is the project's colour and
       not merely tinted by it. */
    background: radial-gradient(120% 62% at 50% -14%,
                color-mix(in oklab, var(--accent) 26%, transparent) 0%, transparent 62%);
  }
  h1 {
    margin: 0; text-align: center; white-space: pre-line;
    font-family: var(--font-heading), system-ui, sans-serif;
    font-size: ${fontSize}px; line-height: 1.06; font-weight: 700;
    letter-spacing: -0.025em; color: var(--text);
  }
  .rule {
    margin: ${Math.round(FRAME.height * 0.028)}px 0 0;
    width: ${ruleW}px; height: ${ruleH}px; border-radius: 999px; background: var(--accent);
  }
  .lede {
    margin: ${Math.round(FRAME.height * 0.024)}px 0 0; text-align: center;
    font-family: var(--font-body), system-ui, sans-serif;
    font-size: ${ledeSize}px; color: var(--muted); max-width: 54ch;
  }
  .window {
    margin-top: ${Math.round(FRAME.height * 0.045)}px; width: ${shotW}px;
    border-radius: ${Math.round(FRAME.width * 0.009)}px;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--line-strong) 80%, transparent);
    box-shadow: 0 ${Math.round(FRAME.height * 0.03)}px ${Math.round(FRAME.height * 0.07)}px
                oklch(0 0 0 / .42);
  }
  .chrome {
    height: ${chromeH}px; display: flex; align-items: center; gap: ${Math.round(chromeH * 0.22)}px;
    padding: 0 ${Math.round(chromeH * 0.5)}px; background: var(--raised);
    border-bottom: 1px solid var(--line);
  }
  .chrome .dot { width: ${Math.round(chromeH * 0.22)}px; height: ${Math.round(chromeH * 0.22)}px; border-radius: 999px; }
  .chrome .r { background: oklch(.68 .18 25); }
  .chrome .y { background: oklch(.8 .15 85); }
  .chrome .g { background: oklch(.75 .16 145); }
  .chrome .addr {
    margin-left: ${Math.round(chromeH * 0.5)}px;
    font-family: var(--font-mono), monospace; font-size: ${Math.round(chromeH * 0.36)}px;
    color: var(--faint);
  }
  .window img { display: block; width: 100%; }
</style>`;
}

/* ------------------------------------------------------------------ board */

async function isUp(): Promise<boolean> {
  try {
    const r = await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

async function startBoard(): Promise<ChildProcess> {
  const child = spawn("bun", ["run", "start"], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, PORT: String(PORT), CLAUDE_TASKS_DB: DB, CLAUDE_TASKS_PORT: String(PORT) },
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isUp()) return child;
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  throw new Error(`The board did not answer on ${ORIGIN}.`);
}

/** Chrome, never a downloaded one: this runs on machines that already have it. */
async function launch(): Promise<Browser> {
  const args = ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"];
  if (process.env.CHROME_PATH) return chromium.launch({ args, executablePath: process.env.CHROME_PATH });
  try {
    return await chromium.launch({ args, channel: "chrome" });
  } catch {
    return chromium.launch({ args });
  }
}

async function capture(page: Page, shot: Shot): Promise<string> {
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${ORIGIN}${shot.path}`, { waitUntil: "networkidle" });
  // The anchor, not a timeout: a capture of the page that responded and one of
  // the page that rendered have to be distinguishable from here.
  await page.getByText(shot.anchor, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: "png" });
  writeFileSync(join(OUT, "raw", `${shot.name}.png`), png);
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function compose(page: Page, shot: Shot, capture: string, theme: ProjectTheme): Promise<void> {
  await page.setViewportSize(FRAME);
  // Land on the board's own origin first: `next/font` has declared all five
  // faces by then, so the frame can name them and the caption is set in the
  // board's actual typeface rather than something that looks like it.
  await page.goto(`${ORIGIN}/`, { waitUntil: "networkidle" });
  await page.evaluate(
    ({ html, css }) => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
      document.body.innerHTML = html;
    },
    { html: frameHtml(shot, capture), css: themeStyleSheet(theme, ":root") },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, `${shot.name}.png`), type: "png" });
}

/* ------------------------------------------------------------------- main */

async function main(): Promise<void> {
  mkdirSync(dirname(DB), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${DB}${suffix}`, { force: true });

  const seeded = spawnSync("bun", [join(ROOT, "scripts", "seed-demo.ts"), "--force"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, CLAUDE_TASKS_DB: DB },
  });
  if (seeded.status !== 0) throw new Error("The demo seed failed; there is nothing to photograph.");

  if (!skipBuild) {
    const built = spawnSync("bun", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
    if (built.status !== 0) throw new Error("The build failed.");
  }

  // Wiped, not just created: a shot that stops being generated has to stop
  // existing, or the README keeps pointing at something no run produced.
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "raw"), { recursive: true });

  const board = await startBoard();
  const browser = await launch();
  const failures: string[] = [];

  try {
    const db = connect(DB);
    // Two contexts, two densities. The board is captured at 2× so it downscales
    // into the frame without softening; the frame itself is already at its final
    // pixel size, and doubling it again would put four 4K PNGs in a repository
    // the marketplace clones onto every machine that installs this.
    const shotPage = await (await browser.newContext({ deviceScaleFactor: 2, reducedMotion: "reduce" })).newPage();
    const framePage = await (await browser.newContext({ deviceScaleFactor: 1, reducedMotion: "reduce" })).newPage();

    for (const shot of SHOTS) {
      try {
        const theme = shot.project ? (getProject(db, shot.project)?.theme ?? NEUTRAL_THEME) : NEUTRAL_THEME;
        await compose(framePage, shot, await capture(shotPage, shot), theme);
        console.log(`  ${shot.name}.png`);
      } catch (error) {
        // Collected rather than thrown: one broken anchor should not hide the
        // state of the other three.
        failures.push(`${shot.name}: ${(error as Error).message}`);
      }
    }
  } finally {
    await browser.close();
    if (keep) console.log(`\nThe board is still up at ${ORIGIN} (kill ${board.pid} when done).`);
    else board.kill("SIGTERM");
  }

  if (failures.length) {
    console.error(`\n${failures.length} shot(s) failed:\n${failures.map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`\n${SHOTS.length} shots at ${FRAME.width}×${FRAME.height} in docs/media/.`);
}

await main();
