"use client";

import { useOptimistic, useTransition } from "react";
import { StarIcon } from "lucide-react";
import { setStarred } from "@/app/actions/tracks";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The star toggle of a /tracks tile. A real button (`aria-pressed`, "Star Job" / "Unstar Job"); the new state shows at once and the action's refresh() brings the server's.
// If the save fails the prop never changes, so the star falls back by itself when the transition ends.
export function StarButton({ id, name, starred }: { id: number; name: string; starred: boolean }) {
  const [shown, setShown] = useOptimistic(starred);
  const [, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={shown}
      aria-label={`${shown ? "Unstar" : "Star"} ${name}`}
      className={shown ? "text-warning" : "text-muted-foreground"}
      onClick={() => startTransition(async () => {
        setShown(!shown);
        await setStarred(id, !shown).catch(() => undefined);
      })}
    >
      <StarIcon aria-hidden className={cn("size-[18px]", shown && "fill-current")} />
    </Button>
  );
}
