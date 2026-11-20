import Link from "next/link";
import { TRACK_SORTS, TRACK_SORT_LABELS, type TrackSort } from "@/lib/track-overview";
import { cn } from "@/lib/utils";

// Recent / Name / Most active as three links (`?sort=`; Recent is the plain /tracks), so it works without JS and the
// choice is in the URL. The current one is `aria-current`.
export function SortControl({ sort }: { sort: TrackSort }) {
  return (
    <div role="group" aria-label="Sort tracks" className="inline-flex rounded-md border border-input bg-card p-0.5">
      {TRACK_SORTS.map((s) => (
        <Link
          key={s}
          href={s === "recent" ? "/tracks" : `/tracks?sort=${s}`}
          replace
          scroll={false}
          aria-current={s === sort ? "true" : undefined}
          className={cn(
            "inline-flex h-7 items-center rounded-sm px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            s === sort ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {TRACK_SORT_LABELS[s]}
        </Link>
      ))}
    </div>
  );
}
