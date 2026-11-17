import Link from "next/link";
import { CircleAlertIcon, ClockIcon } from "lucide-react";
import { firstN } from "@/lib/dashboard";
import type { AttentionItem, TrackOverview } from "@/lib/track-overview";
import { cn } from "@/lib/utils";
import { ROW_LINK } from "../dashboard-card";
import { RecentList } from "../recent-list";
import { StatusBar } from "../status-bar";
import { TrackActions } from "../track-actions";
import { TrackMarker } from "../track-marker";
import { TrackMenu } from "../track-menu";

const SHOWN = 5;
const TONE = { overdue: "font-medium text-destructive", warning: "font-medium text-warning", muted: "text-muted-foreground" } as const;

// A count tile of the Pipeline column. A link to the table filtered to those statuses (`?f=<status column>:<option>.<option>`) when there are any to filter by, else a plain tile.
function Count({ label, value, hint, href }: { label: string; value: number; hint: string | null; href: string | null }) {
  const body = (
    <>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </>
  );
  const cls = "flex min-w-0 flex-col gap-1 rounded-md border border-border bg-background p-3";
  return href
    ? <Link href={href} className={cn(cls, "outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring")}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

function Attention({ items, trackId, trackName }: { items: AttentionItem[]; trackId: number; trackName: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing needs attention</p>;
  const { shown, more } = firstN(items, SHOWN);
  return (
    <>
      <ul className="flex flex-col">
        {shown.map((a) => (
          <li key={a.id} className="border-t border-border py-2 first:border-t-0 first:pt-0 last:pb-0">
            <Link href={`/applications/${a.id}`} className={`line-clamp-2 break-words text-sm font-medium ${ROW_LINK}`}>{a.title}</Link>
            <p className="flex items-baseline justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                {a.tone === "overdue" ? <CircleAlertIcon aria-hidden className="size-3 shrink-0" /> : <ClockIcon aria-hidden className="size-3 shrink-0" />}
                <span className="truncate">{a.kind}</span>
              </span>
              <span className={cn("shrink-0 tabular-nums", TONE[a.tone])}>{a.when}</span>
            </p>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="mt-2 text-xs text-muted-foreground">+{more} more in <Link href={`/tracks/${trackId}`} className={ROW_LINK}>{trackName}</Link></p>}
    </>
  );
}

const H3 = "text-sm font-semibold";

// One track on /tracks (DASH.2, DESIGN.md "Tracks page"): header (name, "N applications · updated 2 hours ago", Table, Board, + Add), then three columns separated by hairlines
// (`gap-px` over `bg-border`): Pipeline (Wins/Submitted/To apply counts, the bar), Needs attention and Recently updated. Cells never go empty: below `lg` Pipeline spans the row, below `md` all stack.
export function TrackPanel({ track: t, color }: { track: TrackOverview; color: string }) {
  const col = t.pipeline.statusColumnId;
  const link = (ids: number[]) => (col !== null && ids.length ? `/tracks/${t.id}?f=${col}:${ids.join(".")}` : null);
  return (
    <section aria-labelledby={`track-${t.id}`} className="min-w-0 rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <TrackMarker name={t.name} color={color} />
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <h2 id={`track-${t.id}`} className="text-lg font-semibold tracking-tight break-words"><Link href={`/tracks/${t.id}`} className={ROW_LINK}>{t.name}</Link></h2>
            <p className="text-sm text-muted-foreground">{t.total} {t.total === 1 ? "application" : "applications"}{t.updated !== null && ` · updated ${t.updated}`}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TrackActions id={t.id} name={t.name} />
          <TrackMenu id={t.id} name={t.name} color={color} />
        </div>
      </header>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-b-lg bg-border md:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3 bg-card p-4 md:col-span-2 lg:col-span-1">
          <h3 className={H3}>Pipeline</h3>
          <div className="grid grid-cols-3 gap-2">
            <Count label="To apply" value={t.toApply} hint={null} href={link(t.ids.todo)} />
            <Count label="Submitted" value={t.submitted} hint={`${t.submittedThisMonth} this month`} href={link(t.ids.submitted)} />
            <Count label="Wins" value={t.wins} hint={t.winRate === null ? null : `${t.winRate}% of submitted`} href={link(t.ids.win)} />
          </div>
          <StatusBar pipeline={t.pipeline} />
        </div>
        <div className="flex min-w-0 flex-col gap-3 bg-card p-4">
          <h3 className={H3}>Needs attention <span className="font-normal text-muted-foreground">· {t.attention.length}</span></h3>
          <Attention items={t.attention} trackId={t.id} trackName={t.name} />
        </div>
        <div className="flex min-w-0 flex-col gap-3 bg-card p-4">
          <h3 className={H3}>Recently updated</h3>
          <RecentList items={t.recent} status />
        </div>
      </div>
    </section>
  );
}
