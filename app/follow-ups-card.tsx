import { connection } from "next/server";
import { localToday } from "@/lib/deadline";
import { firstN } from "@/lib/dashboard";
import { getFollowUpsDue } from "@/lib/db/planner";
import { FollowUpsList } from "@/app/planner/follow-ups-list";
import { DashboardCard } from "./dashboard-card";

const SHOWN = 5;

// FR-9.2: the same list as /planner (getFollowUpsDue), oldest first; the header counts all of them, the body shows the first few.
// One link only: with more than shown, it names how many the planner holds (no second "N more" link to the same place).
export async function FollowUpsCard({ className }: { className?: string }) {
  await connection();
  const items = await getFollowUpsDue(localToday());
  const { shown, more } = firstN(items, SHOWN);
  return (
    <DashboardCard title="Follow-ups due" count={items.length || undefined} link={{ href: "/planner#follow-ups", label: more > 0 ? `All ${items.length} in Planner` : "Open Planner" }} className={className}>
      <FollowUpsList items={shown} compact />
    </DashboardCard>
  );
}
