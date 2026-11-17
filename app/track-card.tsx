import Link from "next/link";
import { ArrowRightIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/track-overview";
import type { TrackOverview } from "@/lib/track-overview";
import { cn } from "@/lib/utils";
import { ROW_LINK } from "./dashboard-card";
import { TrackStatusBar } from "./status-bar";
import { TrackMarker } from "./track-marker";

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

// The dashboard's compact track card (DASH.3, DESIGN.md "Dashboard"): the same flat `bg-card` section as every card. Header: the track's colour marker, the name (a link to its table) and a primary
// "+ Add"; body: three numbers (Applications, To apply, Submitted), the status bar (its label lists every count) and Table / Board. The visually hidden name tells the cards' identical labels apart.
export function TrackCard({ track: t, className }: { track: TrackOverview; className?: string }) {
  const sr = <span className="sr-only"> {t.name}</span>;
  return (
    <section aria-labelledby={`track-${t.id}`} className={cn("min-w-0 rounded-lg border border-border bg-card", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <TrackMarker name={t.name} color={t.color} />
          <h2 id={`track-${t.id}`} className="min-w-0 text-base font-semibold tracking-tight break-words"><Link href={`/tracks/${t.id}`} className={ROW_LINK}>{t.name}</Link></h2>
        </div>
        <Button asChild size="sm" className="shrink-0"><Link href={`/tracks/${t.id}#add-application`}><PlusIcon aria-hidden />Add{sr}</Link></Button>
      </header>
      <div className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-3 gap-3">
          <Figure label="Applications" value={t.total} />
          <Figure label="To apply" value={t.toApply} />
          <Figure label="Submitted" value={t.submitted} />
        </div>
        <TrackStatusBar pipeline={t.pipeline} />
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link href={`/tracks/${t.id}`}>Table{sr}</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href={`/tracks/${t.id}?view=board`}>Board{sr}</Link></Button>
        </div>
      </div>
    </section>
  );
}

// The last tile of the track row: the totals, how many need attention, and the way to /tracks. One link (name = its text).
export function AllTracksTile({ tracks, className }: { tracks: readonly TrackOverview[]; className?: string }) {
  const apps = tracks.reduce((n, t) => n + t.total, 0);
  const need = tracks.reduce((n, t) => n + t.attention.length, 0);
  return (
    <Link href="/tracks" className={cn("flex min-w-0 flex-col justify-center gap-2 rounded-lg border border-border bg-card p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", className)}>
      <span className="text-sm font-medium text-muted-foreground">All tracks</span>
      <span className="text-xl font-semibold tracking-tight">{plural(apps, "application")} in {plural(tracks.length, "track")}</span>
      <span className="text-sm text-muted-foreground">{need} {need === 1 ? "needs" : "need"} attention</span>
      <span className="mt-1 inline-flex items-center gap-1 text-base font-medium text-accent">View tracks<ArrowRightIcon aria-hidden className="size-4" /></span>
    </Link>
  );
}
