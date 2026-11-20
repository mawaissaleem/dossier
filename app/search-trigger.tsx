"use client";

import { useSyncExternalStore } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chordLabel, isMacPlatform } from "@/lib/search-palette";
import { RAIL_ITEM, RailLabel, RailTip } from "./rail";

// The palette itself is mounted once, in the app frame (search-palette.tsx); every button that opens it just says so
// with this event.
export const OPEN_SEARCH_EVENT = "dossier:open-search";
const open = () => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));

export const useIsMac = () =>
  useSyncExternalStore(
    () => () => {},
    () => isMacPlatform(navigator.platform),
    () => false,
  );

// The sidebar's Search item (a button, so it opens the palette instead of going to a page). Expanded it shows the
// shortcut at the right. `before` runs first (the phone panel closes itself: the palette stays shut while another
// dialog is open), and the palette then opens on the next tick, once that dialog is marked closed.
export function SearchRailButton({ className, before }: { className?: string; before?: () => void }) {
  const mac = useIsMac();
  return (
    <button
      type="button"
      aria-label="Search"
      aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
      onClick={
        before
          ? () => {
              before();
              setTimeout(open, 0);
            }
          : open
      }
      className={`${RAIL_ITEM} ${className ?? ""}`}
    >
      <SearchIcon aria-hidden />
      <RailLabel>Search</RailLabel>
      <kbd
        aria-hidden
        className="ml-auto hidden rounded-sm border border-border px-1.5 text-xs font-medium text-muted-foreground wide:inline"
      >
        {chordLabel(mac)}
      </kbd>
      <RailTip>Search</RailTip>
    </button>
  );
}

// The dashboard header's outline Search button, with the shortcut.
export function SearchHeaderButton() {
  const mac = useIsMac();
  return (
    <Button type="button" variant="outline" aria-keyshortcuts={mac ? "Meta+K" : "Control+K"} onClick={open}>
      <SearchIcon aria-hidden />
      Search
      <kbd className="ml-1 rounded-sm border border-border px-1.5 text-xs font-medium text-muted-foreground">
        {chordLabel(mac)}
      </kbd>
    </Button>
  );
}
