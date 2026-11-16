"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// The per-track links under "Tracks" in the side navigation: name and non-archived count, the current track lit like a NavLink (bg-muted, semibold, 3px accent bar).
// Hidden below `lg`, where the navigation is a top bar. The list sits beside the Tracks link, not inside it, so the counts are a sibling `<ul>` of links.
export function TrackNavLinks({ tracks }: { tracks: { id: number; name: string; count: number }[] }) {
  const path = usePathname();
  return (
    <ul aria-label="Tracks" className="mt-0.5 mb-1 ml-5 hidden flex-col gap-0.5 border-l border-border pl-2 lg:flex">
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
  );
}
