import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ChevronRightIcon } from "lucide-react";
import { listTracks } from "@/lib/db/tracks";
import { EmptyState } from "@/components/empty-state";
import { Page, PageHeader } from "@/components/page-header";

// Request-time data under cacheComponents: connection() opts out of prerendering, Suspense keeps the heading in the static shell.
async function TrackList() {
  await connection();
  const tracks = await listTracks();
  if (tracks.length === 0) return <EmptyState title="No tracks yet" description={<>Run <code>npm run db:seed</code> to create the Job and PhD tracks.</>} />;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {tracks.map((t) => (
        <li key={t.id}>
          <Link
            href={`/tracks/${t.id}`}
            className="flex items-center justify-between rounded-lg px-3 py-2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {t.name}
            <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function TracksPage() {
  return (
    <Page narrow>
      <PageHeader title="Tracks" />
      <Suspense fallback={<p className="text-muted-foreground">Loading tracks…</p>}>
        <TrackList />
      </Suspense>
    </Page>
  );
}
