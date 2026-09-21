import { getStore } from "@/lib/core";
import { NEUTRAL_THEME } from "@/lib/theme/tokens";

export const dynamic = "force-dynamic";
export const contentType = "image/svg+xml";
export const size = { width: 32, height: 32 };

/**
 * The tab wears the project's colour too.
 *
 * Hand-written SVG rather than `next/og`: the mark is two shapes, and satori
 * plus a wasm rasteriser to draw them would be the only runtime dependency in
 * the app — on a board whose whole point is that it works with the network
 * down. The lightness values are the ones `tokens.ts` uses for `--bg` and
 * `--accent` in dark mode, which is what a favicon is always read against.
 */
export default async function Icon({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const theme = (await getStore().getProject(slug))?.theme ?? NEUTRAL_THEME;
  const ink = `oklch(0.155 ${theme.neutralChroma} ${theme.hue})`;
  const accent = `oklch(0.74 ${theme.chroma} ${theme.hue})`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="${ink}"/>
  <rect x="6.5" y="6.5" width="19" height="19" rx="4.5" fill="none" stroke="${accent}" stroke-width="2.5"/>
  <path d="M10.5 16.4l3.9 3.9 7.1-7.6" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

  return new Response(svg, {
    headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
  });
}
