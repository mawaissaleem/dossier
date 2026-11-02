import Link from "next/link";
import type { TrackListItem } from "@/lib/db/tracks";

// Plain links (no client JS): work without JS and open in a new tab on middle-click.
export function TrackTabs({ tracks, currentId }: { tracks: TrackListItem[]; currentId: number }) {
  return (
    <nav aria-label="Tracks" className="mb-4 flex gap-1 border-b">
      {tracks.map((t) => {
        const active = t.id === currentId;
        return (
          <Link
            key={t.id}
            href={`/tracks/${t.id}`}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? "border-current font-semibold" : "border-transparent opacity-70 hover:opacity-100"}`}
          >
            {t.name}
          </Link>
        );
      })}
    </nav>
  );
}
