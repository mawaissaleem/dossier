import { Suspense } from "react";
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { FileStackIcon, LayoutDashboardIcon, RouteIcon, SettingsIcon, SquareKanbanIcon } from "lucide-react";
import "./globals.css";
import { BackupBanner } from "./backup-banner";
import { DatabaseGate } from "./database-gate";
import { NavLink } from "./nav-link";
import { SearchPalette } from "./search-palette";
import { SearchRailButton } from "./search-trigger";
import { ThemeMenu } from "./theme-switcher";
import { UpdatedNote } from "./updated-note";
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Dossier",
  description: "Track your job and PhD applications and find the exact files you sent to each one.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set before first paint by the inline script (the choice lives in localStorage, so the layout stays static); the attribute differs from the server's, hence suppressHydrationWarning.
    <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning className={`${GeistSans.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col md:flex-row">
        {/* The icon rail from md up (72px, sticky); below that the same icons form a top bar, so nothing overflows sideways. */}
        <nav
          aria-label="Main"
          className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-card p-2 md:sticky md:top-0 md:h-screen md:w-18 md:flex-col md:flex-nowrap md:border-r md:border-b-0 md:px-0 md:py-4"
        >
          {/* The logo mark: one of the three places an accent gradient is allowed (DESIGN.md). Not a link: Dashboard is the next item. */}
          <span role="img" aria-label="Dossier" className="mr-2 grid size-9 shrink-0 place-items-center rounded-lg bg-linear-to-br from-accent to-accent-to text-accent-foreground md:mr-0 md:mb-3.5">
            <FileStackIcon aria-hidden className="size-[18px]" />
          </span>
          {/* usePathname suspends on dynamic routes under cacheComponents; the boundary keeps the build working. */}
          <Suspense>
            <NavLink href="/" icon={<LayoutDashboardIcon aria-hidden />} label="Dashboard" />
            <NavLink href="/tracks" icon={<SquareKanbanIcon aria-hidden />} label="Tracks" />
            <NavLink href="/planner" icon={<RouteIcon aria-hidden />} label="Planner" />
          </Suspense>
          <SearchRailButton />
          <Suspense>
            <NavLink href="/settings" icon={<SettingsIcon aria-hidden />} label="Settings" className="ml-auto md:mt-auto md:ml-0" />
          </Suspense>
          <ThemeMenu />
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
