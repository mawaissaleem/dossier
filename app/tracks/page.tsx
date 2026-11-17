import { Suspense } from "react";
import { ClockIcon, SquareKanbanIcon, StarIcon } from "lucide-react";
import { connection } from "next/server";
import { localToday } from "@/lib/deadline";
import { getRecentlyViewed } from "@/lib/db/recently-viewed";
import { getTrackOverviews } from "@/lib/db/track-overview";
import { getStarredTrackIds } from "@/lib/db/tracks";
import { onlyExisting } from "@/lib/recently-viewed";
import { overviewSummary, parseTrackSort, sortTracks } from "@/lib/track-overview";
import { EmptyState } from "@/components/empty-state";
import { Page, PageHeader } from "@/components/page-header";
import { AddTrack } from "../add-track";
import { RecentlyViewed } from "./recently-viewed";
import { SortControl } from "./sort-control";
import { TrackTile } from "./track-tile";

type Props = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4";
const H2 = "mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground [&_svg]:size-4";

// Request-time data under cacheComponents: connection() opts out of prerendering, Suspense keeps the heading in the static shell.
// The header sentence and the sections share one cached read (getTrackOverviews), so they cannot disagree.
async function Summary() {
  await connection();
  const tracks = await getTrackOverviews(localToday());
  return tracks.length ? overviewSummary(tracks) : null;
}

// Nothing to sort before the first track exists.
async function Sort({ searchParams }: Props) {
  await connection();
  if (!(await getTrackOverviews(localToday())).length) return null;
  return <SortControl sort={parseTrackSort((await searchParams).sort)} />;
}

// Recently viewed (when any), Starred (when any), then every track: the same tile in an auto-fill grid (300px minimum), so every width fills its rows.
async function Sections({ searchParams }: Props) {
  await connection();
  const sort = parseTrackSort((await searchParams).sort);
  const tracks = sortTracks(await getTrackOverviews(localToday()), sort);
  if (tracks.length === 0) return <EmptyState title="No tracks yet" description="A track holds one kind of application, with its own columns and statuses. Start from the Job or PhD template, or a blank one."><AddTrack /></EmptyState>;
  const [starred, viewed] = [await getStarredTrackIds(), await getRecentlyViewed()];
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const recent = onlyExisting(viewed, new Set(byId.keys()));
  const stars = tracks.filter((t) => starred.has(t.id));
  return (
    <div className="flex flex-col gap-7">
      {recent.length > 0 && (
        <section aria-labelledby="recent-h">
          <h2 id="recent-h" className={H2}><ClockIcon aria-hidden />Recently viewed</h2>
          <RecentlyViewed items={recent} tracks={byId} />
        </section>
      )}
      {stars.length > 0 && (
        <section aria-labelledby="starred-h">
          <h2 id="starred-h" className={H2}><StarIcon aria-hidden />Starred</h2>
          <div className={GRID}>{stars.map((t) => <TrackTile key={t.id} track={t} starred figures />)}</div>
        </section>
      )}
      <section aria-labelledby="all-h">
        <h2 id="all-h" className={H2}><SquareKanbanIcon aria-hidden />All tracks</h2>
        <div className={GRID}>{tracks.map((t) => <TrackTile key={t.id} track={t} starred={starred.has(t.id)} />)}</div>
      </section>
    </div>
  );
}

// Full width like the dashboard (same cap).
export default function TracksPage({ searchParams }: Props) {
  return (
    <div className="max-w-[1760px]">
      <Page>
        <PageHeader
          title="Tracks"
          description={<Suspense fallback={null}><Summary /></Suspense>}
          actions={<><Suspense fallback={null}><Sort searchParams={searchParams} /></Suspense><AddTrack /></>}
        />
        <Suspense fallback={<p className="text-muted-foreground">Loading tracks…</p>}>
          <Sections searchParams={searchParams} />
        </Suspense>
      </Page>
    </div>
  );
}
