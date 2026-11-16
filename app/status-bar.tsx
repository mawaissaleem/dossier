import Link from "next/link";
import { chipClasses } from "@/lib/colors";
import { pipelineSummary, type TrackPipeline } from "@/lib/pipeline";
import { cn } from "@/lib/utils";
import { ROW_LINK } from "./dashboard-card";

const swatch = (color: string | null) => (color === null ? "bg-muted" : chipClasses(color));

// FR-9.6 (DESIGN.md "Dashboard"): one stacked bar of the track's statuses (the option's own chip colour) and a legend "Label N" under it; shared by the dashboard's TrackCard and the /tracks panel.
// The bar and the legend swatches carry a `border-input` outline (3:1 on the card in all themes, tests/theme-contrast.test.ts) and the bar's 1px gaps show
// `bg-input`, so the pale Paper chips and the "No status" segment (`bg-muted`) stay visible and separate from each other and from the card.
// The bar is one image with the counts as its label and is not focusable; the legend entries are the links (the track's table filtered to that status, `?f=<status column>:<option>`), so tab order = legend order.
export function StatusBar({ pipeline: t }: { pipeline: TrackPipeline }) {
  if (t.statusColumnId === null) return <p className="text-sm text-muted-foreground">No status column.</p>;
  return (
    <div>
      <div role="img" aria-label={`${t.name}: ${pipelineSummary(t)}`} className="flex h-3 gap-px overflow-hidden rounded-full border border-input bg-input">
        {t.segments.filter((s) => s.count > 0).map((s) => (
          <div key={s.token} style={{ flexGrow: s.count, flexBasis: 0 }} className={cn("h-full", swatch(s.color))} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {t.segments.map((s) => (
          <li key={s.token}>
            <Link href={`/tracks/${t.id}?f=${t.statusColumnId}:${s.token}`} className={cn("inline-flex items-center gap-1.5 tabular-nums", ROW_LINK, s.count === 0 && "text-muted-foreground")}>
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full border border-input", swatch(s.color))} />
              {s.label} {s.count}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
