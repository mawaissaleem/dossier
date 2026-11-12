import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { Page, PageHeader } from "@/components/page-header";
import { getCapacity, getPlannerBuffers, getPlannerSlots, getRankingRules, getStillToDoChoices, getWeeksPlan } from "@/lib/db/planner";
import { localToday } from "@/lib/deadline";
import { listTracks } from "@/lib/db/tracks";
import { RankingList } from "../ranking-list";
import { CapacityForm } from "./capacity-form";
import { BuffersForm } from "./buffers-form";
import { RulesForm } from "./rules-form";
import { SlotsForm } from "./slots-form";
import { ResetForm } from "./reset-form";
import { ResetEpoch, ResetKeyed } from "./reset-epoch";
import { StillToDoForm } from "./still-to-do-form";

// The DB is request-time under cacheComponents, so this section sits inside a Suspense boundary.
async function SlotsSection() {
  await connection();
  const tracks = await listTracks();
  if (!tracks.length) return <p className="text-sm text-muted-foreground">No tracks yet.</p>;
  const forms = await Promise.all(tracks.map(async (t) => ({ t, ...(await getPlannerSlots(t.id)) })));
  return (
    <div className="flex flex-col gap-3">
      {forms.map(({ t, slots, choices }) => <SlotsForm key={t.id} trackId={t.id} trackName={t.name} initial={slots} choices={choices} />)}
    </div>
  );
}

async function BuffersSection() {
  await connection();
  const tracks = await listTracks();
  if (!tracks.length) return <p className="text-sm text-muted-foreground">No tracks yet.</p>;
  const cards = await Promise.all(tracks.map(async (t) => ({ t, buffers: await getPlannerBuffers(t.id) })));
  return (
    <div className="flex flex-col gap-3">
      {cards.map(({ t, buffers }) => <BuffersForm key={t.id} trackName={t.name} buffers={buffers} />)}
    </div>
  );
}

async function StillToDoSection() {
  await connection();
  const tracks = await listTracks();
  if (!tracks.length) return <p className="text-sm text-muted-foreground">No tracks yet.</p>;
  const cards = await Promise.all(tracks.map(async (t) => ({ t, choices: await getStillToDoChoices(t.id) })));
  return (
    <div className="flex flex-col gap-3">
      {cards.map(({ t, choices }) => <StillToDoForm key={t.id} trackId={t.id} trackName={t.name} choices={choices} />)}
    </div>
  );
}

async function RulesSection() {
  await connection();
  return <RulesForm initial={await getRankingRules()} />;
}

async function CapacitySection() {
  await connection();
  return <CapacityForm initial={await getCapacity()} />;
}

// The live preview: read per request like /planner. Every settings action calls refresh(), which re-renders this page's server components,
// so a save in any section redraws this list in the same round trip (no manual reload).
async function PreviewSection() {
  await connection();
  const { capacity, plan, rest } = await getWeeksPlan(localToday());
  if (!plan.length) return <p className="text-sm text-muted-foreground">Nothing to rank yet. Check Still to do and Engine slots.</p>;
  const more = rest.slice(0, Math.max(0, 10 - plan.length));
  return (
    <>
      <RankingList items={plan.slice(0, 10)} />
      {more.length > 0 && (
        <>
          <p className="my-2 border-t border-border pt-2 text-xs text-muted-foreground">This week&apos;s plan ends here (the top {capacity}). Up next:</p>
          <RankingList items={more} start={plan.length + 1} />
        </>
      )}
    </>
  );
}

const SECTIONS = [["engine-slots", "Engine slots"], ["buffers", "Buffers"], ["still-to-do", "Still to do"], ["ranking-rules", "Ranking rules"], ["capacity", "Weekly capacity"], ["reset", "Reset to defaults"], ["preview", "Ranking preview"]];

export default function PlannerSettingsPage() {
  return (
    <Page>
      <PageHeader title="Planner settings" back={{ href: "/planner", label: "Planner" }} description="Every planner rule is here. The preview on the right (below the rules on a narrow screen) follows each save." />
      <nav aria-label="Sections" className="-mt-2 mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className="rounded-sm text-accent underline outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</a>)}
      </nav>
      <ResetEpoch>
      <div className="grid gap-x-10 lg:grid-cols-[minmax(0,40rem)_minmax(0,1fr)]">
      <div className="min-w-0">
      <ResetKeyed>
      <section aria-labelledby="engine-slots" className="mb-8">
        <h2 id="engine-slots" className="mb-2 scroll-mt-6 text-lg font-semibold">Engine slots</h2>
        <p className="mb-3 text-sm text-muted-foreground">Choose which column of each track feeds the planner. Every slot is optional; None leaves it out.</p>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <SlotsSection />
        </Suspense>
      </section>
      <section aria-labelledby="buffers" className="mb-8">
        <h2 id="buffers" className="mb-2 scroll-mt-6 text-lg font-semibold">Buffers</h2>
        <p className="mb-3 text-sm text-muted-foreground">Days of margin an option adds when ranking: a higher buffer makes the application due sooner. Blank counts as 0.</p>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <BuffersSection />
        </Suspense>
      </section>
      <section aria-labelledby="still-to-do" className="mb-8">
        <h2 id="still-to-do" className="mb-2 scroll-mt-6 text-lg font-semibold">Still to do</h2>
        <p className="mb-3 text-sm text-muted-foreground">Only applications in the checked statuses are ranked. Applications with no status are never ranked.</p>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <StillToDoSection />
        </Suspense>
      </section>
      <section aria-labelledby="ranking-rules" className="mb-8">
        <h2 id="ranking-rules" className="mb-2 scroll-mt-6 text-lg font-semibold">Ranking rules</h2>
        <p className="mb-3 text-sm text-muted-foreground">How overdue applications and applications with no deadline are handled. These apply to all tracks.</p>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <RulesSection />
        </Suspense>
      </section>
      <section aria-labelledby="capacity" className="mb-8">
        <h2 id="capacity" className="mb-2 scroll-mt-6 text-lg font-semibold">Weekly capacity</h2>
        <p className="mb-3 text-sm text-muted-foreground">How many applications you aim to work on in a week. The top ones of the ranking form this week&apos;s plan on the Planner. Applies to all tracks.</p>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <CapacitySection />
        </Suspense>
      </section>
      </ResetKeyed>
      <section aria-labelledby="reset" className="mb-8">
        <h2 id="reset" className="mb-2 scroll-mt-6 text-lg font-semibold">Reset to defaults</h2>
        <p className="mb-3 text-sm text-muted-foreground">Put every planner rule back to how Dossier ships. Experiment freely: this undoes it.</p>
        <ResetForm />
      </section>
      </div>
      <aside id="preview" aria-labelledby="preview-title" className="min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
        <h2 id="preview-title" className="mb-1 text-lg font-semibold">Ranking preview</h2>
        <p className="mb-3 text-sm text-muted-foreground">The top 10 of the Planner, updated when you save.</p>
        <ResetKeyed>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <PreviewSection />
        </Suspense>
        </ResetKeyed>
        <Link href="/planner" className="mt-3 inline-block rounded-sm text-sm text-accent underline outline-none focus-visible:ring-2 focus-visible:ring-ring">Open the full Planner</Link>
      </aside>
      </div>
      </ResetEpoch>
    </Page>
  );
}
