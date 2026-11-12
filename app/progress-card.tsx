import { CheckIcon, FlameIcon } from "lucide-react";
import { connection } from "next/server";
import { localToday } from "@/lib/deadline";
import { getWeeklyProgress } from "@/lib/db/planner";
import { DashboardCard } from "./dashboard-card";

const R = 52;
const C = 2 * Math.PI * R;

// FR-9.4: the ring (DESIGN.md "Dashboard"). The whole figure is one image with the sentence as its label; the SVG and its text are decoration.
export async function ProgressCard({ className }: { className?: string }) {
  await connection();
  const { count, capacity, ratio, met, label, streak } = await getWeeklyProgress(localToday());
  return (
    <DashboardCard title="This week" link={{ href: "/planner", label: "Open Planner" }} className={className}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div role="img" aria-label={`${count} of ${capacity} applications submitted this week`} className="relative size-36 shrink-0">
          <svg aria-hidden viewBox="0 0 120 120" className="size-full -rotate-90">
            <circle cx="60" cy="60" r={R} strokeWidth="10" className={`stroke-border ${met ? "fill-muted" : "fill-none"}`} />
            <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" className="stroke-accent" strokeDasharray={`${ratio * C} ${C}`} />
          </svg>
          <p aria-hidden className="absolute inset-0 flex flex-col items-center justify-center tabular-nums">
            <span className="text-4xl font-semibold tracking-tight">{count}</span>
            <span className="text-sm text-muted-foreground">of {capacity}</span>
          </p>
        </div>
        <div className="min-w-0">
          <p className="font-medium">submitted this week</p>
          <p className="text-sm tabular-nums text-muted-foreground">{label}</p>
          {met && (
            <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-accent"><CheckIcon aria-hidden className="size-4" />Weekly goal met</p>
          )}
          {streak > 0 ? (
            <p className="mt-2 flex items-center gap-1.5 text-sm font-medium">
              <FlameIcon aria-hidden className="size-4 text-accent" />
              <span aria-hidden>{streak}-week streak</span>
              <span className="sr-only">{`Streak: ${streak} ${streak === 1 ? "week" : "weeks"} in a row meeting the weekly capacity of ${capacity}.`}</span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No streak yet</p>
          )}
          {!met && (
            <p className="text-sm text-muted-foreground">{capacity - count} more to {streak > 0 ? "extend the streak" : "start a streak"}</p>
          )}
        </div>
      </div>
    </DashboardCard>
  );
}
