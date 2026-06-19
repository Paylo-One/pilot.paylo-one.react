import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// IBM Plex Sans + IBM Plex Mono, the locked MVP type system, self-hosted via
// next/font (matches the marketing site).
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pilot by Paylo.one",
  description:
    "A calm intelligence layer for leaders. Know what matters. Lose the noise.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // cover + safe-area padding in globals.css keeps the sticky topbar and the
  // dark command layer clear of notches/home indicators on modern phones.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1014" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          data-* attributes onto <body> before React hydrates. This suppresses
          the warning for <body>'s own attributes only — one level deep — so it
          does not mask real hydration mismatches in the app. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
