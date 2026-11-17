import Link from "next/link";
import { connection } from "next/server";
import { EmptyState } from "@/components/empty-state";
import { localToday } from "@/lib/deadline";
import { getWeeksPlan } from "@/lib/db/planner";
import { getTrackOverviews } from "@/lib/db/track-overview";
import { allTracksPipeline, pipelineSummary } from "@/lib/pipeline";
import { OptionChip } from "./option-chip";
import { ACCENT_LINK, DashboardCard, ROW_LINK } from "./dashboard-card";
import { StatusBar } from "./status-bar";

type Plan = Awaited<ReturnType<typeof getWeeksPlan>>["plan"];

// The plan's rows: a rank square, the title (a link), "Track · why it ranks here" and the application's status chip at the right ("Overdue" in the red chip instead when it is).
function Rows({ items }: { items: Plan }) {
  return (
    <ol className="flex flex-col">
      {items.map((it, i) => (
        <li key={it.id} className="flex items-start gap-3 border-t border-border py-3 first:border-t-0 first:pt-0">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-sm font-medium tabular-nums text-muted-foreground"><span className="sr-only">Rank </span>{i + 1}</span>
          <div className="min-w-0 flex-1">
            <Link href={`/applications/${it.id}`} className={`break-words font-medium ${ROW_LINK}`}>{it.title}</Link>
            <p className="mt-0.5 text-xs text-muted-foreground">{it.trackName} · {it.reasoning}</p>
          </div>
          {it.overdue ? <OptionChip option={{ label: "Overdue", color: "red" }} /> : it.status && <OptionChip option={it.status} />}
        </li>
      ))}
    </ol>
  );
}

// FR-9.1: the same top N as /planner (getWeeksPlan), read per request because it depends on today and live data. (No tracks at all is the page's "Start here".)
// "Pipeline · all tracks" sits under the list in the same card: one bar of every track's statuses added up by label, with the legend (the track cards hold the per-track bars).
export async function PlanCard({ className }: { className?: string }) {
  await connection();
  const today = localToday();
  const [{ plan }, tracks] = [await getWeeksPlan(today), await getTrackOverviews(today)];
  const all = allTracksPipeline(tracks.map((t) => t.pipeline));
  return (
    <DashboardCard title="This week's plan" count={plan.length || undefined} link={{ href: "/planner", label: "Open Planner" }} className={className} bodyClassName="flex flex-col gap-4">
      {!plan.length ? (
        <EmptyState title="Nothing to rank" description={<>Mark statuses as still to do in <Link href="/planner/settings" className={ACCENT_LINK}>Planner settings</Link>.</>} />
      ) : (
        <Rows items={plan} />
      )}
      {all.total > 0 && (
        <section aria-labelledby="pipeline-all" className="mt-auto border-t border-border pt-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 id="pipeline-all" className="text-base font-semibold tracking-tight">Pipeline · all tracks</h3>
            <span className="text-sm text-muted-foreground">{all.total} {all.total === 1 ? "application" : "applications"}</span>
          </div>
          <StatusBar segments={all.segments} label={`All tracks: ${pipelineSummary(all)}`} legend />
        </section>
      )}
    </DashboardCard>
  );
}
