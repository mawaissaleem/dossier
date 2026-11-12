import Link from "next/link";
import { connection } from "next/server";
import { EmptyState } from "@/components/empty-state";
import { localToday } from "@/lib/deadline";
import { getWeeksPlan } from "@/lib/db/planner";
import { RankingList } from "@/app/planner/ranking-list";
import { ACCENT_LINK, DashboardCard } from "./dashboard-card";

// FR-9.1: the same top N as /planner (getWeeksPlan), read per request because it depends on today and live data. (No tracks at all is the page's "Start here".)
export async function PlanCard({ className }: { className?: string }) {
  await connection();
  const { plan } = await getWeeksPlan(localToday());
  return (
    <DashboardCard title="This week's plan" count={plan.length || undefined} link={{ href: "/planner", label: "Open Planner" }} className={className}>
      {!plan.length ? (
        <EmptyState title="Nothing to rank" description={<>Mark statuses as still to do in <Link href="/planner/settings" className={ACCENT_LINK}>Planner settings</Link>.</>} />
      ) : (
        <RankingList items={plan} compact />
      )}
    </DashboardCard>
  );
}
