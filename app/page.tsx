import { Suspense } from "react";
import { connection } from "next/server";
import { EmptyState } from "@/components/empty-state";
import { Page, PageHeader } from "@/components/page-header";
import { summaryLine } from "@/lib/dashboard";
import { localToday } from "@/lib/deadline";
import { getOverdueAlerts, getUpcomingDeadlines, getWeeklyProgress } from "@/lib/db/planner";
import { getTrackOverviews } from "@/lib/db/track-overview";
import { getWins } from "@/lib/db/wins";
import { listTracks } from "@/lib/db/tracks";
import { DashboardTiles } from "./dashboard-tiles";
import { FollowUpsCard } from "./follow-ups-card";
import { OverdueCard } from "./overdue-card";
import { PlanCard } from "./plan-card";
import { TrackCard } from "./track-card";
import { WinsCard } from "./wins-card";

// One sentence about today from numbers the cards show anyway (React `cache` in lib/db/planner.ts makes the second read free). Nothing before the first track exists.
async function Summary() {
  await connection();
  if (!(await listTracks()).length) return null;
  const today = localToday();
  const [overdue, upcoming, { count, capacity }] = [await getOverdueAlerts(today), await getUpcomingDeadlines(today, 1), await getWeeklyProgress(today)];
  return summaryLine(today, { overdue: overdue.length, nextDays: upcoming[0]?.days ?? null, count, capacity });
}

// Reading order = tab order = DOM order: the four tiles (Overdue, Next deadline, This week, Wins), then the plan, then the rail (Overdue list when any, Follow-ups, Recent wins),
// then the track cards (context, not a to-do; one per track, empty ones too). Phone: one column in that order. md to lg: the same, the rail cards two-up (an odd last one takes the
// full row), the track cards side by side. xl: the plan and the track cards in the main column, the rail (23rem) beside them; the rail is placed with `row-span-2` so the DOM order stays plan, rail, cards. No cell is ever empty.
async function Cards() {
  await connection();
  if (!(await listTracks()).length) {
    return <EmptyState title="Start here" description={<>Dossier keeps your applications in tracks. Run <code>npm run db:seed</code> to create the Job and PhD tracks, then open Tracks and add your first application.</>} />;
  }
  const today = localToday();
  const [overdue, { labels }, tracks] = [await getOverdueAlerts(today), await getWins(), await getTrackOverviews(today)];
  const rail = [overdue.length > 0 && OverdueCard, FollowUpsCard, labels.length > 0 && WinsCard].filter((C): C is Exclude<typeof C, false> => C !== false);
  return (
    <>
      <DashboardTiles />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_23rem] xl:grid-rows-[auto_1fr]">
        <PlanCard />
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:row-span-2 xl:grid-cols-1">
          {rail.map((C, i) => <C key={i} className={rail.length % 2 === 1 && i === rail.length - 1 ? "md:max-xl:col-span-2" : undefined} />)}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {tracks.map((t, i) => <TrackCard key={t.id} track={t} className={tracks.length % 2 === 1 && i === tracks.length - 1 ? "md:col-span-2" : undefined} />)}
        </div>
      </div>
    </>
  );
}

// Fills the main area up to 1760px (the cards and tiles use the width; the narrow pages keep their own cap).
export default function DashboardPage() {
  return (
    <div className="max-w-[1760px]">
      <Page>
        <PageHeader title="Dashboard" description={<Suspense fallback={null}><Summary /></Suspense>} />
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <Cards />
        </Suspense>
      </Page>
    </div>
  );
}
