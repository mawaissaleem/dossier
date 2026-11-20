import { Suspense } from "react";
import { LayoutDashboardIcon, RouteIcon, SettingsIcon, SquareKanbanIcon } from "lucide-react";
import { NavLink } from "./nav-link";
import { SearchRailButton } from "./search-trigger";
import { ThemeMenu } from "./theme-switcher";

// The items of the navigation, in order: Dashboard, Tracks (its track links, `tracks`, follow it when expanded),
// Planner, Search, a spacer, Settings, Theme. The side bar / top bar (app/layout.tsx) and the phone panel
// (app/sidebar.tsx) both render them; below `md` they are a row of icons, so Settings keeps `ml-auto` there, and as a
// column (expanded, phone panel) the spacer is `mt-auto`.
export function NavItems({ tracks, onSearch }: { tracks: React.ReactNode; onSearch?: () => void }) {
  return (
    <>
      {/* usePathname suspends on dynamic routes under cacheComponents; the boundary keeps the build working. */}
      <Suspense>
        <NavLink href="/" icon={<LayoutDashboardIcon aria-hidden />} label="Dashboard" />
        <NavLink href="/tracks" icon={<SquareKanbanIcon aria-hidden />} label="Tracks" />
      </Suspense>
      {tracks}
      <Suspense>
        <NavLink href="/planner" icon={<RouteIcon aria-hidden />} label="Planner" />
      </Suspense>
      <SearchRailButton before={onSearch} />
      <Suspense>
        <NavLink
          href="/settings"
          icon={<SettingsIcon aria-hidden />}
          label="Settings"
          className="max-md:ml-auto md:mt-auto wide:mt-auto wide:ml-0"
        />
      </Suspense>
      <ThemeMenu />
    </>
  );
}
