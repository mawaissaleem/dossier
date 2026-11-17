import { chipClasses } from "@/lib/colors";
import { cn } from "@/lib/utils";

// The track's colour as a small tile with its first letter (a chip colour token pair, so it is AA in every theme). Decorative: the name is always written next to it.
export function TrackMarker({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold uppercase", chipClasses(color), className)}>
      {Array.from(name.trim())[0] ?? "?"}
    </span>
  );
}
