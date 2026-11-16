import Link from "next/link";
import type { TrackOverview } from "@/lib/track-overview";
import { ROW_LINK } from "./dashboard-card";
import { RecentList } from "./recent-list";
import { StatusBar } from "./status-bar";
import { TrackActions } from "./track-actions";

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

// The dashboard's track card (DASH.2, DESIGN.md "Dashboard"): the same flat `bg-card` section as every card, with a header (the track name links to its table, then Table, Board and + Add),
// three numbers (Applications, To apply, Submitted), the status bar with its legend and the three most recently updated applications. No next deadline: urgency lives in the tiles.
export function TrackCard({ track: t, className }: { track: TrackOverview; className?: string }) {
  return (
    <section aria-labelledby={`track-${t.id}`} className={`min-w-0 rounded-lg border border-border bg-card ${className ?? ""}`}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <h2 id={`track-${t.id}`} className="text-base font-semibold tracking-tight"><Link href={`/tracks/${t.id}`} className={ROW_LINK}>{t.name}</Link></h2>
        <TrackActions id={t.id} name={t.name} />
      </header>
      <div className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-3 gap-3">
          <Figure label="Applications" value={t.total} />
          <Figure label="To apply" value={t.toApply} />
          <Figure label="Submitted" value={t.submitted} />
        </div>
        <StatusBar pipeline={t.pipeline} />
        <div className="border-t border-border pt-3">
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Recently updated</h3>
          <RecentList items={t.recent} />
        </div>
      </div>
    </section>
  );
}
