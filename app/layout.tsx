import { Suspense } from "react";
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { BackupBanner } from "./backup-banner";
import { DatabaseGate } from "./database-gate";
import { NavItems } from "./nav-items";
import { SearchPalette } from "./search-palette";
import { SidebarHeader } from "./sidebar";
import { TrackNav } from "./track-nav";
import { UpdatedNote } from "./updated-note";
import { SIDEBAR_INIT_SCRIPT } from "@/lib/sidebar";
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Dossier",
  description: "Track your job and PhD applications and find the exact files you sent to each one.",
};

// The per-track links read the database at request time, so they get their own boundary with no fallback: the
// navigation around them stays in the static shell. Both navigations (side and phone panel) show them.
const tracks = (
  <Suspense>
    <TrackNav />
  </Suspense>
);

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set before first paint by the inline script (the choice lives in localStorage, so the layout stays
    // static); the attribute differs from the server's, hence suppressHydrationWarning.
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      suppressHydrationWarning
      className={`${GeistSans.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Copies the sidebar cookie to <html data-sidebar> before first paint (same trick as the theme): the
            layout stays static and the first paint has the right width. */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col md:flex-row">
        {/* From md up a sticky full-height sidebar: the 72px icon rail, or 240px with labels and track links when
            expanded (the width eases over 150ms and pushes the page). Below md the same icons form a top bar, so
            nothing overflows sideways; its logo opens the full navigation as a panel. */}
        <nav
          id="main-nav"
          aria-label="Main"
          className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-card p-2 md:sticky md:top-0 md:h-screen md:w-18 md:flex-col md:flex-nowrap md:border-r md:border-b-0 md:px-0 md:py-4 md:transition-[width] md:duration-150 wide:items-stretch wide:px-3 wide:w-60"
        >
          <SidebarHeader tracks={tracks} />
          <NavItems tracks={tracks} />
          <SearchPalette />
        </nav>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Suspense>
            <BackupBanner />
          </Suspense>
          <Suspense>
            <UpdatedNote />
          </Suspense>
          <Suspense>
            <DatabaseGate>{children}</DatabaseGate>
          </Suspense>
        </main>
      </body>
    </html>
  );
}
