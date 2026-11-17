import { Suspense } from "react";
import { connection } from "next/server";
import { localToday } from "@/lib/deadline";
import { getTrackOverviews } from "@/lib/db/track-overview";
import { listTracks } from "@/lib/db/tracks";
import { overviewSummary } from "@/lib/track-overview";
import { EmptyState } from "@/components/empty-state";
import { Page, PageHeader } from "@/components/page-header";
import { AddTrack } from "../add-track";
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
  if (tracks.length === 0) return <EmptyState title="No tracks yet" description="A track holds one kind of application, with its own columns and statuses. Start from the Job or PhD template, or a blank one."><AddTrack /></EmptyState>;
  const colors = new Map((await listTracks()).map((t) => [t.id, t.color]));
  return <div className="flex flex-col gap-4">{tracks.map((t) => <TrackPanel key={t.id} track={t} color={colors.get(t.id)!} />)}</div>;
}

// Full width like the dashboard (same cap), one panel per track.
export default function TracksPage() {
  return (
    <div className="max-w-[1760px]">
      <Page>
        <PageHeader title="Tracks" description={<Suspense fallback={null}><Summary /></Suspense>} actions={<AddTrack />} />
        <Suspense fallback={<p className="text-muted-foreground">Loading tracks…</p>}>
          <Panels />
        </Suspense>
      </Page>
    </div>
  );
}
