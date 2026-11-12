import Link from "next/link";
import { CircleAlertIcon } from "lucide-react";
import type { getPlannerList } from "@/lib/db/planner";
import { cn } from "@/lib/utils";

export type RankingItems = Awaited<ReturnType<typeof getPlannerList>>;

// `start` = the rank of the first item, so a list that continues another keeps counting. Shared by /planner, the live preview in /planner/settings and the dashboard.
// `compact` = rows without their own card, divided by hairlines, for use inside a card.
export function RankingList({ items, start = 1, compact }: { items: RankingItems; start?: number; compact?: boolean }) {
  return (
    <ol start={start} className={cn("flex flex-col", !compact && "gap-2")}>
      {items.map((it, i) => (
        <li key={it.id} className={cn("flex items-start gap-3", compact ? "border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0" : "rounded-lg border border-border bg-card p-3")}>
          <span className="w-6 shrink-0 pt-px text-right text-sm font-medium tabular-nums text-muted-foreground">
            <span className="sr-only">Rank </span>{i + start}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Link href={`/applications/${it.id}`} className="break-words rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{it.title}</Link>
              <span className="text-xs text-muted-foreground">{it.trackName}</span>
              {it.overdue && (
                <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                  <CircleAlertIcon aria-hidden className="size-3.5 shrink-0" />Overdue
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{it.reasoning}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
