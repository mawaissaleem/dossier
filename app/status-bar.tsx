import { chipClasses } from "@/lib/colors";
import { pipelineSummary, type CountedStatus, type TrackPipeline } from "@/lib/pipeline";
import { cn } from "@/lib/utils";

const swatch = (color: string | null) => (color === null ? "bg-muted" : chipClasses(color));

// FR-9.6 (DESIGN.md "Dashboard"): one stacked bar of statuses, each in the option's own chip colour. The bar and the legend swatches carry a `border-input` outline (3:1 on the card in all themes,
// tests/theme-contrast.test.ts) and the bar's 1px gaps show `bg-input`, so the pale Paper chips and the "No status" segment (`bg-muted`) stay visible and separate from each other and from the card.
// The bar is one image with the counts as its label (`label`, which lists every count) and is not focusable. `legend` adds a plain "Label N" list under it (not links: on the all-tracks bar a status belongs to several tracks).
// `thin` = 8px (the /tracks tiles) instead of 12px (the dashboard). An empty pipeline is one muted bar.
export function StatusBar({
  segments,
  label,
  legend,
  thin,
}: {
  segments: readonly CountedStatus[];
  label: string;
  legend?: boolean;
  thin?: boolean;
}) {
  const shown = segments.filter((s) => s.count > 0);
  return (
    <div>
      <div
        role="img"
        aria-label={label}
        className={cn("flex gap-px overflow-hidden rounded-full border border-input bg-input", thin ? "h-2" : "h-3")}
      >
        {shown.length === 0 && <div className="h-full flex-1 bg-muted" />}
        {shown.map((s, i) => (
          <div
            key={`${s.label}-${i}`}
            style={{ flexGrow: s.count, flexBasis: 0 }}
            className={cn("h-full", swatch(s.color))}
          />
        ))}
      </div>
      {legend && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {segments.map((s, i) => (
            <li
              key={`${s.label}-${i}`}
              className={cn("inline-flex items-center gap-1.5 tabular-nums", s.count === 0 && "text-muted-foreground")}
            >
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full border border-input", swatch(s.color))} />
              {s.label} {s.count}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// One track's bar. A track without a status column has no segments to draw.
export function TrackStatusBar({ pipeline: t, thin }: { pipeline: TrackPipeline; thin?: boolean }) {
  if (t.statusColumnId === null) return <p className="text-sm text-muted-foreground">No status column.</p>;
  return <StatusBar segments={t.segments} label={`${t.name}: ${pipelineSummary(t)}`} thin={thin} />;
}
