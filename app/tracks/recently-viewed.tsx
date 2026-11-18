import Link from "next/link";
import { TRACK_VIEW_LABELS, type ViewedTrack } from "@/lib/recently-viewed";
import type { TrackOverview } from "@/lib/track-overview";
import { TrackMarker } from "../track-marker";

// Up to six chips: the track's colour tile, "Job · Board" and when. Each is one link to that track in that view. `items` is already cleaned (no deleted tracks).
export function RecentlyViewed({
  items,
  tracks,
}: {
  items: readonly (ViewedTrack & { when: string })[];
  tracks: ReadonlyMap<number, TrackOverview>;
}) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
      {items.map((v) => {
        const t = tracks.get(v.trackId)!;
        return (
          <li key={`${v.trackId}-${v.view}`} className="min-w-0">
            <Link
              href={v.view === "board" ? `/tracks/${t.id}?view=board` : `/tracks/${t.id}`}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3 outline-none transition-colors hover:bg-popover focus-visible:ring-2 focus-visible:ring-ring"
            >
              <TrackMarker name={t.name} color={t.color} className="size-8 text-sm" />
              <span className="min-w-0">
                <span className="block truncate text-base font-medium">
                  {t.name} · {TRACK_VIEW_LABELS[v.view]}
                </span>
                <span className="block text-xs text-muted-foreground">{v.when}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
