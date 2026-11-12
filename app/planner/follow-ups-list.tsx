import Link from "next/link";
import { deadlineInfo } from "@/lib/deadline";
import { cn } from "@/lib/utils";
import type { getFollowUpsDue } from "@/lib/db/planner";

export type FollowUps = Awaited<ReturnType<typeof getFollowUpsDue>>;

// The "Follow-ups due" list (FR-8.10). Plain muted text, never destructive: a follow-up is a reminder, not a deadline. Shared by /planner and the dashboard.
// `compact` = rows without their own card, divided by hairlines, for use inside a card.
export function FollowUpsList({ items, compact }: { items: FollowUps; compact?: boolean }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No follow-ups due.</p>;
  return (
    <ul className={cn("flex flex-col", !compact && "gap-2")}>
      {items.map((it) => (
        <li key={it.id} className={cn("flex flex-wrap items-baseline gap-x-2", compact ? "border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0" : "rounded-lg border border-border bg-card p-3")}>
          <Link href={`/applications/${it.id}`} className="break-words rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{it.title}</Link>
          <span className="text-xs text-muted-foreground">{it.trackName}</span>
          <span className="text-sm text-muted-foreground">Follow up {deadlineInfo(it.followUp, null)?.date} · {it.text}</span>
        </li>
      ))}
    </ul>
  );
}
