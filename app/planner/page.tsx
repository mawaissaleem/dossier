import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { SettingsIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Page, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { localToday } from "@/lib/deadline";
import { getFollowUpsDue, getWeeksPlan } from "@/lib/db/planner";
import { listTracks } from "@/lib/db/tracks";
import { FollowUpsList } from "./follow-ups-list";
import { RankingList } from "./ranking-list";

// The ranking depends on today and live data, so it is read per request, inside Suspense (cacheComponents).
async function Ranking() {
  await connection();
  const today = localToday();
  const [tracks, { capacity, plan, rest }, followUps] = [await listTracks(), await getWeeksPlan(today), await getFollowUpsDue(today)];
  if (!tracks.length) return <EmptyState title="No tracks yet" description="Create a track to start planning." />;
  return (
    <div className="flex flex-col gap-8">
      {!plan.length ? (
        <EmptyState title="Nothing to rank" description={<>Mark statuses as still to do in <Link href="/planner/settings" className="rounded-sm text-accent underline outline-none focus-visible:ring-2 focus-visible:ring-ring">Planner settings</Link>.</>} />
      ) : (
      <section aria-labelledby="weeks-plan">
        <h2 id="weeks-plan" className="mb-1 text-lg font-semibold">This week&apos;s plan · {capacity}</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {plan.length < capacity ? `${plan.length} of ${capacity}: that is everything ranked.` : `The top ${capacity}.`}{" "}
          Change the weekly capacity in <Link href="/planner/settings#capacity" className="rounded-sm text-accent underline outline-none focus-visible:ring-2 focus-visible:ring-ring">Planner settings</Link>.
        </p>
        <RankingList items={plan} />
      </section>
      )}
      <section aria-labelledby="follow-ups">
        <h2 id="follow-ups" className="mb-1 text-lg font-semibold">Follow-ups due</h2>
        <p className="mb-3 text-sm text-muted-foreground">Submitted applications whose follow-up date has arrived. They do not affect the ranking.</p>
        <FollowUpsList items={followUps} />
      </section>
      {rest.length > 0 && (
        <section aria-labelledby="up-next">
          <h2 id="up-next" className="mb-3 text-lg font-semibold">Up next</h2>
          <RankingList items={rest} start={plan.length + 1} />
        </section>
      )}
    </div>
  );
}

export default function PlannerPage() {
  return (
    <Page narrow>
      <PageHeader
        title="Planner"
        actions={<Button asChild variant="outline"><Link href="/planner/settings"><SettingsIcon aria-hidden />Planner settings</Link></Button>}
      />
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Ranking />
      </Suspense>
    </Page>
  );
}
