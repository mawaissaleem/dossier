import { connection } from "next/server";
import { deadlineTile, overdueTile, weekHint } from "@/lib/dashboard";
import { localToday } from "@/lib/deadline";
import { getOverdueAlerts, getUpcomingDeadlines, getWeeklyProgress } from "@/lib/db/planner";
import { getWins } from "@/lib/db/wins";
import { noWinsText, winCountsText } from "@/lib/wins";
import { StatTile } from "./stat-tile";

const R = 52;
const C = 2 * Math.PI * R;

// FR-9.4: the ring (DESIGN.md "Dashboard"), 40px on a phone and 48px from sm. The figure is one image with the sentence as its label; the SVG is decoration. The count is in the tile's value.
function Ring({ count, capacity, ratio, met }: { count: number; capacity: number; ratio: number; met: boolean }) {
  return (
    <span role="img" aria-label={`${count} of ${capacity} applications submitted this week`} className="size-10 shrink-0 sm:size-12">
      <svg aria-hidden viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={R} strokeWidth="10" className={`stroke-border ${met ? "fill-muted" : "fill-none"}`} />
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" className="stroke-accent" strokeDasharray={`${ratio * C} ${C}`} />
      </svg>
    </span>
  );
}

// FR-9.1 to FR-9.5 and FR-9.7 at a glance: Overdue (always), Next deadline, This week, Wins (only once a win status is configured, so 3 tiles then).
// Everything is a cached per-request read (lib/db/planner.ts, lib/db/wins.ts), shared with the cards and the summary line. The tile order is the tab order.
export async function DashboardTiles() {
  await connection();
  const today = localToday();
  const [overdue, upcoming, week, { labels, wins }] = await Promise.all([getOverdueAlerts(today), getUpcomingDeadlines(today, 1), getWeeklyProgress(today), getWins()]);
  const o = overdueTile(overdue);
  const d = deadlineTile(upcoming[0]);
  const hasWins = labels.length > 0;
  // < xl: two columns, and with 3 tiles the last takes the full row (no empty cell). xl: one row of 4 (or 3).
  return (
    <div className={`mb-4 grid grid-cols-2 gap-4 ${hasWins ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
      <StatTile href="/planner" label="Overdue" value={o.value} hint={o.hint} alert={o.alert} />
      <StatTile href="/planner" label="Next deadline" value={d.value} hint={d.hint} />
      <StatTile
        href="/planner"
        label="This week"
        value={<>{week.count}<span className="text-base font-medium text-muted-foreground"> of {week.capacity}</span></>}
        hint={weekHint(week)}
        lead={<Ring count={week.count} capacity={week.capacity} ratio={week.ratio} met={week.met} />}
        className={hasWins ? undefined : "col-span-2 xl:col-span-1"}
      />
      {hasWins && <StatTile href="#wins" label="Wins" value={wins.length} hint={wins.length ? winCountsText(wins, labels) : noWinsText(labels)} />}
    </div>
  );
}
