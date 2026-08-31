import type { ProjectTheme } from "@/lib/db/types";

/**
 * A project's identity is a hue, a chroma and a texture. Everything else —
 * every lightness in the interface — is fixed here, per mode.
 *
 * That split is the whole trick: an agent inventing a theme for a new project
 * can make it look like anything and still cannot make text unreadable, because
 * it never gets to choose how light the text or the background is.
 */

interface Ramp {
  bg: number;
  surface: number;
  raised: number;
  line: number;
  lineStrong: number;
  text: number;
  muted: number;
  faint: number;
  accent: number;
  accentInk: number;
  accentSoft: number;
  softChroma: number;
  shadow: string;
}

const DARK: Ramp = {
  bg: 0.155,
  surface: 0.195,
  raised: 0.235,
  line: 0.3,
  lineStrong: 0.42,
  text: 0.965,
  muted: 0.735,
  faint: 0.575,
  accent: 0.74,
  accentInk: 0.17,
  accentSoft: 0.28,
  softChroma: 0.45,
  shadow: "none",
};

const LIGHT: Ramp = {
  bg: 0.975,
  surface: 1,
  raised: 0.955,
  line: 0.885,
  lineStrong: 0.78,
  text: 0.235,
  muted: 0.475,
  faint: 0.615,
  // 0.47 rather than the 0.53 that looks right by eye: at high chroma around
  // hue 190 a lighter accent drops white text to 3.75:1, and the accent is a
  // text background (pressed filter chips). test/theme.test.ts sweeps for this.
  accent: 0.47,
  accentInk: 0.99,
  accentSoft: 0.945,
  softChroma: 0.35,
  shadow: "0 1px 2px oklch(0 0 0 / .05), 0 8px 24px -12px oklch(0 0 0 / .12)",
};

function ramp(mode: "dark" | "light", theme: ProjectTheme): Record<string, string> {
  const r = mode === "dark" ? DARK : LIGHT;
  const h = theme.hue;
  const nc = theme.neutralChroma;
  const c = theme.chroma;
  const a2 = theme.accent2Hue ?? theme.hue;

  return {
    "--bg": `oklch(${r.bg} ${nc} ${h})`,
    "--surface": `oklch(${r.surface} ${nc * 0.7} ${h})`,
    "--raised": `oklch(${r.raised} ${nc} ${h})`,
    "--line": `oklch(${r.line} ${nc} ${h})`,
    "--line-strong": `oklch(${r.lineStrong} ${nc} ${h})`,
    "--text": `oklch(${r.text} ${nc * 0.5} ${h})`,
    "--muted": `oklch(${r.muted} ${nc} ${h})`,
    "--faint": `oklch(${r.faint} ${nc} ${h})`,
    "--accent": `oklch(${r.accent} ${c} ${h})`,
    "--accent-2": `oklch(${r.accent} ${c} ${a2})`,
    "--accent-ink": `oklch(${r.accentInk} ${c * 0.25} ${h})`,
    "--accent-soft": `oklch(${r.accentSoft} ${c * r.softChroma} ${h})`,
    "--shadow": r.shadow,
    // Semantic colours keep their own hue on purpose: "overdue" must mean the
    // same thing in every project, including one whose accent is already red.
    "--danger": `oklch(${mode === "dark" ? 0.72 : 0.53} 0.19 25)`,
    "--danger-soft": `oklch(${mode === "dark" ? 0.28 : 0.95} 0.07 25)`,
    // 0.50 in light mode, not 0.52: on its own soft tint the greener value only
    // reached 4.39:1, and this is the "resuelto en código" badge, which is small text.
    "--success": `oklch(${mode === "dark" ? 0.75 : 0.5} 0.14 152)`,
    "--success-soft": `oklch(${mode === "dark" ? 0.27 : 0.94} 0.05 152)`,
  };
}

const RADII: Record<ProjectTheme["radius"], string> = {
  sharp: "2px",
  soft: "8px",
  round: "16px",
};

export const HEADING_FONT_VAR: Record<ProjectTheme["fontHeading"], string> = {
  geometric: "var(--font-geometric)",
  grotesque: "var(--font-grotesque)",
  serif: "var(--font-serif)",
  mono: "var(--font-mono)",
};

/**
 * The motif is drawn from the accent at low alpha, so it can never fight text.
 * Image and size are separate custom properties: `background-image` does not
 * take the position/size shorthand, and a motif that silently does not paint is
 * worse than no motif.
 */
function motifLayers(theme: ProjectTheme, mode: "dark" | "light"): { image: string; size: string } {
  const alpha = mode === "dark" ? 0.085 : 0.07;
  const tint = `oklch(${mode === "dark" ? 0.74 : 0.53} ${theme.chroma} ${theme.hue} / ${alpha})`;
  switch (theme.motif) {
    case "grid":
      return {
        image: `linear-gradient(${tint} 1px, transparent 1px), linear-gradient(90deg, ${tint} 1px, transparent 1px)`,
        size: "100% 34px, 34px 100%",
      };
    case "dots":
      return { image: `radial-gradient(${tint} 1.3px, transparent 1.3px)`, size: "22px 22px" };
    case "lines":
      return { image: `repeating-linear-gradient(135deg, ${tint} 0 1px, transparent 1px 14px)`, size: "auto" };
    case "glow":
      return {
        image:
          `radial-gradient(120% 75% at 80% -12%, oklch(${mode === "dark" ? 0.74 : 0.53} ${theme.chroma} ${theme.hue} / ${alpha * 3.2}) 0%, transparent 62%)`,
        size: "100% 100%",
      };
    case "noise":
      return {
        image: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='${alpha}'/%3E%3C/svg%3E")`,
        size: "120px 120px",
      };
    default:
      return { image: "none", size: "auto" };
  }
}

function declarations(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

/**
 * Emits the whole palette as a stylesheet scoped to `[data-theme-scope]`, with
 * the dark and light variants both present so a viewer on "system" gets the
 * right one without a round trip.
 */
export function themeStyleSheet(theme: ProjectTheme, scope = ":root"): string {
  const dark = declarations(ramp("dark", theme));
  const light = declarations(ramp("light", theme));
  const motifDark = motifLayers(theme, "dark");
  const motifLight = motifLayers(theme, "light");
  const shared = declarations({
    "--radius": RADII[theme.radius],
    "--radius-sm": theme.radius === "sharp" ? "2px" : theme.radius === "soft" ? "5px" : "10px",
    "--font-heading": HEADING_FONT_VAR[theme.fontHeading],
    "--hue": String(theme.hue),
    "--chroma": String(theme.chroma),
  });
  const motif = (m: { image: string; size: string }) =>
    `--motif-image:${m.image};--motif-size:${m.size}`;

  if (theme.mode === "dark") return `${scope}{color-scheme:dark;${dark};${shared};${motif(motifDark)}}`;
  if (theme.mode === "light") return `${scope}{color-scheme:light;${light};${shared};${motif(motifLight)}}`;

  return [
    `${scope}{color-scheme:light dark;${light};${shared};${motif(motifLight)}}`,
    `@media (prefers-color-scheme: dark){${scope}{${dark};${motif(motifDark)}}}`,
  ].join("");
}

/** The neutral identity for the cross-project view, where no project owns the screen. */
export const NEUTRAL_THEME: ProjectTheme = {
  mode: "auto",
  hue: 250,
  chroma: 0.045,
  neutralChroma: 0.004,
  accent2Hue: null,
  motif: "none",
  fontHeading: "grotesque",
  radius: "soft",
};
