import Link from "next/link";
import { deadlineInfo } from "@/lib/deadline";
import type { getFollowUpsDue } from "@/lib/db/planner";

export type FollowUps = Awaited<ReturnType<typeof getFollowUpsDue>>;

// The "Follow-ups due" list (FR-8.10). Plain muted text, never destructive: a follow-up is a reminder, not a deadline. Shared by /planner and the Phase 11 dashboard.
export function FollowUpsList({ items }: { items: FollowUps }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No follow-ups due.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it) => (
        <li key={it.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-border bg-card p-3">
          <Link href={`/applications/${it.id}`} className="break-words rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{it.title}</Link>
          <span className="text-xs text-muted-foreground">{it.trackName}</span>
          <span className="text-sm text-muted-foreground">Follow up {deadlineInfo(it.followUp, null)?.date} · {it.text}</span>
        </li>
      ))}
    </ul>
  );
}
