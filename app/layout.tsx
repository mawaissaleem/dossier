import { Suspense } from "react";
import type { Metadata } from "next";
import { LayoutDashboardIcon, ListChecksIcon, SettingsIcon } from "lucide-react";
import "./globals.css";
import { NavLink } from "./nav-link";
import { ThemeSwitcher } from "./theme-switcher";
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Dossier",
  description: "Track your job and PhD applications and find the exact files you sent to each one.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set before first paint by the inline script (the choice lives in localStorage, so the layout stays static); the attribute differs from the server's, hence suppressHydrationWarning.
    <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col lg:flex-row">
        {/* Side navigation from lg up; below that it stacks into a top bar so nothing overflows sideways. */}
        <nav
          aria-label="Main"
          className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border p-2 lg:sticky lg:top-0 lg:h-screen lg:w-56 lg:flex-col lg:flex-nowrap lg:items-stretch lg:border-r lg:border-b-0 lg:p-4"
        >
          <span className="px-3 text-lg font-semibold lg:mb-4">Dossier</span>
          {/* usePathname suspends on dynamic routes under cacheComponents; the boundary keeps the build working. */}
          <Suspense>
            <NavLink href="/" icon={<LayoutDashboardIcon />}>Dashboard</NavLink>
            <NavLink href="/tracks" icon={<ListChecksIcon />}>Tracks</NavLink>
            <NavLink href="/settings" icon={<SettingsIcon />}>Settings</NavLink>
          </Suspense>
          <ThemeSwitcher className="ml-auto flex items-center gap-2 px-3 lg:mt-auto lg:ml-0 lg:grid lg:gap-1" />
        </nav>
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </body>
    </html>
  );
}
