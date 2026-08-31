/**
 * OKLCH → sRGB and WCAG contrast, so the claim that a generated theme cannot
 * break legibility is something the test suite checks rather than something the
 * README asserts.
 */

function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Clamped to the sRGB gamut, which is what a browser paints. */
export function oklchToSrgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const [r, g, b] = oklabToLinearSrgb(L, C * Math.cos(h), C * Math.sin(h));
  return [r, g, b].map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
}

function relativeLuminance(linear: [number, number, number]): number {
  const [r, g, b] = linear;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(
  fg: { L: number; C: number; h: number },
  bg: { L: number; C: number; h: number },
): number {
  const a = relativeLuminance(oklchToSrgb(fg.L, fg.C, fg.h));
  const b = relativeLuminance(oklchToSrgb(bg.L, bg.C, bg.h));
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}
