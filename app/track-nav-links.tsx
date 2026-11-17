"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// The per-track links under "Tracks" in the expanded sidebar (and the phone panel): name and non-archived count, the current track lit like a NavLink (bg-muted, semibold, 3px accent bar).
// Not there in the collapsed rail (`wide:` is the expanded state, see globals.css). The list sits beside the Tracks link, not inside it, so the counts are a sibling `<ul>` of links; it scrolls inside the
// sidebar when long (the wrapper has the slack the focus ring and the bar need, since a scroll area clips what sticks out).
export function TrackNavLinks({ tracks }: { tracks: { id: number; name: string; count: number }[] }) {
  const path = usePathname();
  return (
    <div className="hidden min-h-0 overflow-y-auto px-1 py-0.5 wide:block">
      <ul aria-label="Tracks" className="ml-4 flex flex-col gap-0.5 border-l border-border pl-2">
        {tracks.map((t) => {
          const href = `/tracks/${t.id}`;
          const active = path === href;
          return (
            <li key={t.id}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-muted font-semibold text-foreground before:absolute before:inset-y-1.5 before:-left-2.5 before:w-0.75 before:rounded-full before:bg-linear-to-b before:from-accent before:to-accent-to" : "text-muted-foreground",
                )}
              >
                <span className="truncate">{t.name}</span>
                <span className="text-xs font-normal tabular-nums text-muted-foreground">{t.count}<span className="sr-only"> applications</span></span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
