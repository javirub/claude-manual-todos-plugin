import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono, Outfit, Space_Grotesk } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { NEUTRAL_THEME, themeStyleSheet } from "@/lib/theme/tokens";

import "./globals.css";

const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const geometric = Outfit({ subsets: ["latin"], variable: "--font-geometric", display: "swap" });
const grotesque = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesque", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-serif", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return { title: t("name"), description: t("tagline") };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${body.variable} ${geometric.variable} ${grotesque.variable} ${serif.variable} ${mono.variable}`}
    >
      <head>
        {/* The neutral identity. Each project page overrides these variables with
            its own, later in the cascade, in the same HTML response — so the
            interface arrives already wearing the right colours. */}
        <style dangerouslySetInnerHTML={{ __html: themeStyleSheet(NEUTRAL_THEME) }} />
      </head>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
