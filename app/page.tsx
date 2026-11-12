import { Suspense } from "react";
import { connection } from "next/server";
import { EmptyState } from "@/components/empty-state";
import { Page, PageHeader } from "@/components/page-header";
import { summaryLine } from "@/lib/dashboard";
import { localToday } from "@/lib/deadline";
import { getOverdueAlerts, getUpcomingDeadlines, getWeeklyProgress } from "@/lib/db/planner";
import { listTracks } from "@/lib/db/tracks";
import { DeadlineCard } from "./deadline-card";
import { FollowUpsCard } from "./follow-ups-card";
import { OverdueCard } from "./overdue-card";
import { PlanCard } from "./plan-card";
import { ProgressCard } from "./progress-card";

// One sentence about today from numbers the cards show anyway (React `cache` in lib/db/planner.ts makes the second read free). Nothing before the first track exists.
async function Summary() {
  await connection();
  if (!(await listTracks()).length) return null;
  const today = localToday();
  const [overdue, upcoming, { count, capacity }] = [await getOverdueAlerts(today), await getUpcomingDeadlines(today, 4), await getWeeklyProgress(today)];
  return summaryLine(today, { overdue: overdue.length, nextDays: upcoming[0]?.days ?? null, count, capacity });
}

// Reading order = tab order = DOM order: what is late, what is next, how the week is going, then what to work on, then who to chase.
// Phone: one column in that order. md: two columns (overdue, when there is any, and the plan and follow-ups take the full row). xl: a 6-column grid
// so the top row always fills it (3 cards of 2, or 2 of 3 with no overdue) and the plan (4) sits beside follow-ups (2). No cell is ever empty.
async function Cards() {
  await connection();
  if (!(await listTracks()).length) {
    return <EmptyState title="Start here" description={<>Dossier keeps your applications in tracks. Run <code>npm run db:seed</code> to create the Job and PhD tracks, then open Tracks and add your first application.</>} />;
  }
  const hasOverdue = (await getOverdueAlerts(localToday())).length > 0;
  const top = hasOverdue ? "xl:col-span-2" : "xl:col-span-3";
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
      {hasOverdue && <OverdueCard className="md:col-span-2 xl:col-span-2" />}
      <DeadlineCard className={top} />
      <ProgressCard className={top} />
      <PlanCard className="md:col-span-2 xl:col-span-4" />
      <FollowUpsCard className="md:col-span-2 xl:col-span-2" />
    </div>
  );
}

// Capped at max-w-6xl and left-aligned like the other pages, so on a wide screen the cards stay readable instead of stretching.
export default function DashboardPage() {
  return (
    <div className="max-w-6xl">
      <Page>
        <PageHeader title="Dashboard" description={<Suspense fallback={null}><Summary /></Suspense>} />
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <Cards />
        </Suspense>
      </Page>
    </div>
  );
}
