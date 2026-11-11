import { AlertTriangleIcon, FileXIcon } from "lucide-react";
import { integrityLabel } from "@/lib/file-integrity";
import type { IntegrityState } from "@/lib/db/schema";
import { NoteTime } from "./note-time";

// The red flag for a file whose last hash check failed (FR-5.5, AT-8). Text plus an icon, never colour alone; ok files show nothing.
// Dates are shown as text next to the badge, not only in a title, so keyboard and touch users get them too.
export function IntegrityBadge({ state, checkedAt }: { state: IntegrityState; checkedAt: Date | null }) {
  const label = integrityLabel(state);
  if (!label) return null;
  const Icon = state === "missing" ? FileXIcon : AlertTriangleIcon;
  return (
    <>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-destructive px-1.5 text-xs leading-5 font-medium text-destructive-foreground">
        <Icon aria-hidden className="size-3" />{label}
      </span>
      {checkedAt && <span className="shrink-0 text-xs text-muted-foreground">Checked <NoteTime iso={checkedAt.toISOString()} /></span>}
    </>
  );
}
