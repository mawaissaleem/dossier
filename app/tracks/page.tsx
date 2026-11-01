import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { listTracks } from "@/lib/db/tracks";

// Request-time data under cacheComponents: connection() opts out of prerendering, Suspense keeps the heading in the static shell.
async function TrackList() {
  await connection();
  const tracks = await listTracks();
  if (tracks.length === 0) return <p>No tracks yet. Run <code>npm run db:seed</code>.</p>;
  return (
    <ul className="list-disc pl-6">
      {tracks.map((t) => (
        <li key={t.id}>
          <Link href={`/tracks/${t.id}`} className="underline">{t.name}</Link>
        </li>
      ))}
    </ul>
  );
}

export default function TracksPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Tracks</h1>
      <Suspense fallback={<p>Loading tracks…</p>}>
        <TrackList />
      </Suspense>
    </>
  );
}
