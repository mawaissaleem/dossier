import { Suspense } from "react";
import { connection } from "next/server";
import { localToday } from "@/lib/deadline";
import { getTrackOverviews } from "@/lib/db/track-overview";
import { overviewSummary } from "@/lib/track-overview";
import { EmptyState } from "@/components/empty-state";
import { Page, PageHeader } from "@/components/page-header";
import { TrackPanel } from "./track-panel";

// Request-time data under cacheComponents: connection() opts out of prerendering, Suspense keeps the heading in the static shell.
// The header sentence and the panels share one cached read (getTrackOverviews), so the summary and the panels cannot disagree.
async function Summary() {
  await connection();
  const tracks = await getTrackOverviews(localToday());
  return tracks.length ? overviewSummary(tracks) : null;
}

async function Panels() {
  await connection();
  const tracks = await getTrackOverviews(localToday());
  if (tracks.length === 0) return <EmptyState title="No tracks yet" description={<>Run <code>npm run db:seed</code> to create the Job and PhD tracks.</>} />;
  return <div className="flex flex-col gap-4">{tracks.map((t) => <TrackPanel key={t.id} track={t} />)}</div>;
}

// Full width like the dashboard (same cap), one panel per track.
export default function TracksPage() {
  return (
    <div className="max-w-[1760px]">
      <Page>
        <PageHeader title="Tracks" description={<Suspense fallback={null}><Summary /></Suspense>} />
        <Suspense fallback={<p className="text-muted-foreground">Loading tracks…</p>}>
          <Panels />
        </Suspense>
      </Page>
    </div>
  );
}
