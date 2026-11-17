import { Suspense } from "react";
import { connection } from "next/server";
import { EmptyState } from "@/components/empty-state";
import { Page, PageHeader } from "@/components/page-header";
import { itemsInRow, summaryLine } from "@/lib/dashboard";
import { localToday } from "@/lib/deadline";
import { getOverdueAlerts, getUpcomingDeadlines, getWeeklyProgress } from "@/lib/db/planner";
import { getTrackOverviews } from "@/lib/db/track-overview";
import { getWins } from "@/lib/db/wins";
import { AddApplication } from "./add-application";
import { AddTrack } from "./add-track";
import { DashboardTiles } from "./dashboard-tiles";
import { FollowUpsCard } from "./follow-ups-card";
import { OverdueCard } from "./overdue-card";
import { PlanCard } from "./plan-card";
import { SearchHeaderButton } from "./search-trigger";
import { AllTracksTile, TrackCard } from "./track-card";
import { WinsCard } from "./wins-card";

// One sentence about today from numbers the cards show anyway (React `cache` in lib/db/planner.ts makes the second read free). Nothing before the first track exists.
async function Summary() {
  await connection();
  const today = localToday();
  if (!(await getTrackOverviews(today)).length) return null;
  const [overdue, upcoming, { count, capacity }] = [await getOverdueAlerts(today), await getUpcomingDeadlines(today, 1), await getWeeklyProgress(today)];
  return summaryLine(today, { overdue: overdue.length, nextDays: upcoming[0]?.days ?? null, count, capacity });
}

// Column spans that keep the last row of the track row full: the cards and the All tracks tile are three per row at xl (12 columns, so 4, 6 or 12 wide) and two per row from sm to xl.
const XL_SPAN: Record<number, string> = { 1: "xl:col-span-12", 2: "xl:col-span-6", 3: "xl:col-span-4" };
const SM_SPAN: Record<number, string> = { 1: "sm:max-xl:col-span-2", 2: "sm:max-xl:col-span-1" };
const spans = (i: number, n: number) => `${XL_SPAN[itemsInRow(i, n, 3)]} ${SM_SPAN[itemsInRow(i, n, 2)]}`;

// The bento (DESIGN.md "Dashboard"): one 12-column grid at xl, two columns from sm, one on a phone. Reading order = tab order = DOM order: the four tiles (Overdue, Next deadline, This week, Wins), the plan,
// the rail (Overdue list when any, Follow-ups, Recent wins), then one card per track and the All tracks tile (context, not a to-do). The plan (8 columns) and the rail (4) are one row at xl; the rail's cards
// share its height and the plan stretches to it, so there is no empty cell whatever the rail holds. Below xl the plan and the rail take the full width (the rail two-up from md, an odd last card full row).
async function Cards() {
  await connection();
  const today = localToday();
  const tracks = await getTrackOverviews(today);
  if (!tracks.length) {
    return <EmptyState title="Start here" description="Dossier keeps your applications in tracks. Add a track from the Job or PhD template, or a blank one, then add your first application."><AddTrack /></EmptyState>;
  }
  const [overdue, { labels }] = [await getOverdueAlerts(today), await getWins()];
  const rail = [overdue.length > 0 && OverdueCard, FollowUpsCard, labels.length > 0 && WinsCard].filter((C): C is Exclude<typeof C, false> => C !== false);
  const n = tracks.length + 1;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-12">
      <DashboardTiles />
      <PlanCard className="col-span-full xl:col-span-8" />
      <div className="col-span-full grid grid-cols-1 gap-4 md:grid-cols-2 xl:col-span-4 xl:flex xl:flex-col">
        {rail.map((C, i) => <C key={i} className={`xl:flex-1 ${rail.length % 2 === 1 && i === rail.length - 1 ? "md:max-xl:col-span-2" : ""}`} />)}
      </div>
      {tracks.map((t, i) => <TrackCard key={t.id} track={t} className={spans(i, n)} />)}
      <AllTracksTile tracks={tracks} className={spans(tracks.length, n)} />
    </div>
  );
}

// Fills the main area up to 1760px (the cards and tiles use the width; the narrow pages keep their own cap).
export default function DashboardPage() {
  return (
    <div className="max-w-[1760px]">
      <Page>
        <PageHeader
          title="Dashboard"
          description={<Suspense fallback={null}><Summary /></Suspense>}
          actions={<><SearchHeaderButton /><Suspense fallback={null}><AddApplication /></Suspense></>}
        />
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <Cards />
        </Suspense>
      </Page>
    </div>
  );
}
