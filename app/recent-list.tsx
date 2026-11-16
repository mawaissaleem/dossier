import Link from "next/link";
import type { RecentItem } from "@/lib/track-overview";
import { ROW_LINK } from "./dashboard-card";

// The track's most recently touched applications (title link, relative time); shared by the TrackCard (title and time on one row) and the /tracks panel (`status`: the title takes the full
// width, wrapping up to two lines, and the status and the time share the line under it, because the panel's columns are narrow).
export function RecentList({ items, status }: { items: RecentItem[]; status?: boolean }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No applications yet</p>;
  return (
    <ul className="flex flex-col">
      {items.map((r) => {
        const when = <time dateTime={new Date(r.touchedMs).toISOString()} className="shrink-0 text-xs text-muted-foreground">{r.when}</time>;
        return (
          <li key={r.id} className="border-t border-border py-2 first:border-t-0 first:pt-0 last:pb-0">
            {status ? (
              <>
                <Link href={`/applications/${r.id}`} className={`line-clamp-2 break-words text-sm font-medium ${ROW_LINK}`}>{r.title}</Link>
                <p className="flex items-baseline justify-between gap-3"><span className="min-w-0 truncate text-xs text-muted-foreground">{r.status ?? "No status"}</span>{when}</p>
              </>
            ) : (
              <div className="flex items-baseline justify-between gap-3">
                <Link href={`/applications/${r.id}`} className={`min-w-0 truncate text-sm font-medium ${ROW_LINK}`}>{r.title}</Link>
                {when}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
