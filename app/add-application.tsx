import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { connection } from "next/server";
import { Button } from "@/components/ui/button";
import { localToday } from "@/lib/deadline";
import { getTrackOverviews } from "@/lib/db/track-overview";
import { AddApplicationMenu } from "./add-application-menu";

// The dashboard header's primary button. One track: a link to its add form. Several: a menu of tracks. None: nothing (the page shows the Add track empty state).
// Shares the request's one getTrackOverviews read with the cards.
export async function AddApplication() {
  await connection();
  const tracks = await getTrackOverviews(localToday());
  if (tracks.length === 0) return null;
  if (tracks.length > 1)
    return <AddApplicationMenu tracks={tracks.map(({ id, name, color }) => ({ id, name, color }))} />;
  return (
    <Button asChild>
      <Link href={`/tracks/${tracks[0].id}#add-application`}>
        <PlusIcon aria-hidden />
        Add application
      </Link>
    </Button>
  );
}
