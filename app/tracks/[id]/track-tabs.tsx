import Link from "next/link";
import { cn } from "@/lib/utils";
import type { TrackListItem } from "@/lib/db/tracks";

// Plain links (no client JS): work without JS and open in a new tab on middle-click.
export function TrackTabs({ tracks, currentId }: { tracks: TrackListItem[]; currentId: number }) {
  return (
    <nav aria-label="Tracks" className="mb-4 flex flex-wrap gap-1 border-b border-border">
      {tracks.map((t) => {
        const active = t.id === currentId;
        return (
          <Link
            key={t.id}
            href={`/tracks/${t.id}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative -mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              // Active: a 2px accent-gradient underline drawn over the transparent border.
              active
                ? "border-transparent font-semibold text-foreground after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:bg-linear-to-r after:from-accent after:to-accent-to"
                : "border-transparent text-muted-foreground hover:border-input hover:text-foreground",
            )}
          >
            {t.name}
          </Link>
        );
      })}
    </nav>
  );
}
