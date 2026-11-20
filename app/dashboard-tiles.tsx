import { connection } from "next/server";
import { deadlineTile, overdueTile, weekHint } from "@/lib/dashboard";
import { localToday } from "@/lib/deadline";
import { getOverdueAlerts, getUpcomingDeadlines, getWeeklyProgress } from "@/lib/db/planner";
import { getWins } from "@/lib/db/wins";
import { noWinsText, winCountsText } from "@/lib/wins";
import { StatTile } from "./stat-tile";

const R = 52;
const C = 2 * Math.PI * R;

// FR-9.4: the ring, 64px beside the tile's text. The figure is one image with the sentence as its label; the SVG is
// decoration. The count is in the tile's value.
function Ring({ count, capacity, ratio, met }: { count: number; capacity: number; ratio: number; met: boolean }) {
  return (
    <span
      role="img"
      aria-label={`${count} of ${capacity} applications submitted this week`}
      className="size-16 shrink-0"
    >
      <svg aria-hidden viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={R}
          strokeWidth="12"
          className={`stroke-border ${met ? "fill-muted" : "fill-none"}`}
        />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="12"
          strokeLinecap={ratio > 0 ? "round" : "butt"}
          className="stroke-accent"
          strokeDasharray={`${ratio * C} ${C}`}
        />
      </svg>
    </span>
  );
}

// FR-9.1 to FR-9.5 and FR-9.7 at a glance: Overdue (always), Next deadline, This week, Wins (only once a win status is
// configured, so 3 tiles then). Everything is a cached per-request read (lib/db/planner.ts, lib/db/wins.ts), shared
// with the cards and the summary line. The tile order is the tab order. The tiles are direct children of the
// dashboard's bento grid (page.tsx): 3 columns of 12 each at xl (4 each with 3 tiles), 2 x 2 from sm, one column on a
// phone; with 3 tiles the last takes the full row from sm to xl.
export async function DashboardTiles() {
  await connection();
  const today = localToday();
  const [overdue, upcoming, week, { labels, wins }] = await Promise.all([
    getOverdueAlerts(today),
    getUpcomingDeadlines(today, 1),
    getWeeklyProgress(today),
    getWins(),
  ]);
  const o = overdueTile(overdue);
  const d = deadlineTile(upcoming[0]);
  const hasWins = labels.length > 0;
  const span = hasWins ? "xl:col-span-3" : "xl:col-span-4";
  return (
    <>
      <StatTile href="/planner" label="Overdue" value={o.value} hint={o.hint} alert={o.alert} className={span} />
      <StatTile href="/planner" label="Next deadline" value={d.value} hint={d.hint} className={span} />
      <StatTile
        href="/planner"
        label="This week"
        value={`${week.count} of ${week.capacity}`}
        hint={weekHint(week)}
        lead={<Ring count={week.count} capacity={week.capacity} ratio={week.ratio} met={week.met} />}
        className={hasWins ? span : `${span} sm:max-xl:col-span-2`}
      />
      {hasWins && (
        <StatTile
          href="#wins"
          label="Wins"
          value={String(wins.length)}
          hint={wins.length ? winCountsText(wins, labels) : noWinsText(labels)}
          className={span}
        />
      )}
    </>
  );
}
