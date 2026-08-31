import { describe, expect, test } from "bun:test";

import { contrastRatio } from "@/lib/theme/contrast";
import { NEUTRAL_THEME, themeStyleSheet } from "@/lib/theme/tokens";
import type { ProjectTheme } from "@/lib/db/types";

/**
 * The lightness ramp in tokens.ts is fixed per mode and the agent only picks hue
 * and chroma. These tests sweep the whole space the agent can reach and check
 * that no combination drops below WCAG AA — that is the property the design
 * rests on, so it gets checked rather than asserted.
 */
const RAMPS = {
  dark: { bg: 0.155, surface: 0.195, text: 0.965, muted: 0.735, accent: 0.74, accentInk: 0.17 },
  light: { bg: 0.975, surface: 1, text: 0.235, muted: 0.475, accent: 0.47, accentInk: 0.99 },
};

const HUES = Array.from({ length: 72 }, (_, i) => i * 5);
const CHROMAS = [0.02, 0.08, 0.13, 0.18, 0.22];
const NEUTRAL_CHROMAS = [0, 0.012, 0.03];

describe("no theme an agent can build breaks contrast", () => {
  for (const mode of ["dark", "light"] as const) {
    const r = RAMPS[mode];

    test(`${mode}: body text over the background stays above AA`, () => {
      let worst = Infinity;
      for (const h of HUES) {
        for (const nc of NEUTRAL_CHROMAS) {
          worst = Math.min(
            worst,
            contrastRatio({ L: r.text, C: nc * 0.5, h }, { L: r.bg, C: nc, h }),
            contrastRatio({ L: r.text, C: nc * 0.5, h }, { L: r.surface, C: nc * 0.7, h }),
          );
        }
      }
      // 4.5:1 is AA for body text.
      expect(worst).toBeGreaterThanOrEqual(4.5);
    });

    test(`${mode}: secondary text stays above AA for large text`, () => {
      let worst = Infinity;
      for (const h of HUES) {
        for (const nc of NEUTRAL_CHROMAS) {
          worst = Math.min(worst, contrastRatio({ L: r.muted, C: nc, h }, { L: r.bg, C: nc, h }));
        }
      }
      // 3:1 is AA for large text and UI, which is what --muted is used for.
      expect(worst).toBeGreaterThanOrEqual(3);
    });

    test(`${mode}: text on the accent stays above AA at every hue and chroma`, () => {
      let worst = Infinity;
      let worstAt = "";
      for (const h of HUES) {
        for (const c of CHROMAS) {
          const ratio = contrastRatio({ L: r.accentInk, C: c * 0.25, h }, { L: r.accent, C: c, h });
          if (ratio < worst) {
            worst = ratio;
            worstAt = `hue ${h}, chroma ${c}`;
          }
        }
      }
      expect(worst, `peor caso en ${worstAt}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("semantic colours", () => {
  test("the overdue badge reads against its own tint in both modes", () => {
    expect(contrastRatio({ L: 0.72, C: 0.19, h: 25 }, { L: 0.28, C: 0.07, h: 25 })).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio({ L: 0.53, C: 0.19, h: 25 }, { L: 0.95, C: 0.07, h: 25 })).toBeGreaterThanOrEqual(4.5);
  });

  test("the agent-resolved badge reads against its own tint in both modes", () => {
    expect(contrastRatio({ L: 0.75, C: 0.14, h: 152 }, { L: 0.27, C: 0.05, h: 152 })).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio({ L: 0.5, C: 0.14, h: 152 }, { L: 0.94, C: 0.05, h: 152 })).toBeGreaterThanOrEqual(4.5);
  });
});

describe("stylesheet emission", () => {
  const theme: ProjectTheme = {
    mode: "dark",
    hue: 295,
    chroma: 0.16,
    neutralChroma: 0.012,
    accent2Hue: null,
    motif: "grid",
    fontHeading: "geometric",
    radius: "soft",
  };

  test("a fixed mode emits one block with a motif image and its size", () => {
    const css = themeStyleSheet(theme);
    expect(css).toContain("color-scheme:dark");
    expect(css).toContain("--motif-image:linear-gradient(");
    // background-image does not take the shorthand, so size travels separately.
    expect(css).toContain("--motif-size:100% 34px, 34px 100%");
    expect(css).not.toContain("@media");
  });

  test("auto emits both palettes so a system-themed viewer needs no round trip", () => {
    const css = themeStyleSheet({ ...theme, mode: "auto" });
    expect(css).toContain("color-scheme:light dark");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
  });

  test("the neutral identity is nearly colourless, so project dots keep meaning", () => {
    expect(NEUTRAL_THEME.chroma).toBeLessThan(0.06);
  });
});
