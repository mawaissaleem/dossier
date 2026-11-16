import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// Table, Board and + Add for one track: the header buttons of the dashboard's TrackCard and the /tracks panel. The visually hidden track name tells the two cards' identical labels apart for a screen reader.
// "Add" goes to the add form at the top of the track page (`#add-application`, app/tracks/[id]/page.tsx).
export function TrackActions({ id, name }: { id: number; name: string }) {
  const sr = <span className="sr-only"> {name}</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm"><Link href={`/tracks/${id}`}>Table{sr}</Link></Button>
      <Button asChild variant="outline" size="sm"><Link href={`/tracks/${id}?view=board`}>Board{sr}</Link></Button>
      <Button asChild size="sm"><Link href={`/tracks/${id}#add-application`}><PlusIcon aria-hidden />Add{sr}</Link></Button>
    </div>
  );
}
