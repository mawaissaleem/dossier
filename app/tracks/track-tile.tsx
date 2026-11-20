import Link from "next/link";
import { CircleAlertIcon } from "lucide-react";
import { attentionLine, plural, type TrackOverview } from "@/lib/track-overview";
import { TrackStatusBar } from "../status-bar";
import { TrackMarker } from "../track-marker";
import { TrackMenu } from "../track-menu";
import { StarButton } from "./star-button";

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-background px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tracking-tight tabular-nums">{value}</span>
    </div>
  );
}

// One track on /tracks: a flat `bg-card` tile, the whole tile one link to the track. The name is the link and a
// stretched `::after` makes the tile its target, with the focus ring drawn on the tile; the star and the options menu
// sit above it (`z-10`) as separate buttons, so there is no interactive element inside the link. `figures` (Starred)
// adds To apply / Submitted / Wins. The attention line is always words ("1 overdue · 2 more need attention", "Next
// deadline in 6 days"); the red and the icon only add to them.
export function TrackTile({
  track: t,
  starred,
  figures,
}: {
  track: TrackOverview;
  starred: boolean;
  figures?: boolean;
}) {
  const a = attentionLine(t);
  return (
    <article className="relative flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:border-input hover:bg-popover has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
      <div className="flex items-start gap-3">
        <TrackMarker name={t.name} color={t.color} className="size-10 rounded-lg text-base" />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold tracking-tight break-words">
            <Link href={`/tracks/${t.id}`} className="outline-none after:absolute after:inset-0 after:rounded-lg">
              {t.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t.total === 0 ? "No applications yet" : `${plural(t.total, "application")} · updated ${t.updated}`}
          </p>
        </div>
        <div className="relative z-10 flex shrink-0 items-center">
          <StarButton id={t.id} name={t.name} starred={starred} />
          <TrackMenu id={t.id} name={t.name} color={t.color} />
        </div>
      </div>
      {figures && (
        <div className="grid grid-cols-3 gap-2">
          <Figure label="To apply" value={t.toApply} />
          <Figure label="Submitted" value={t.submitted} />
          <Figure label="Wins" value={t.wins} />
        </div>
      )}
      <TrackStatusBar pipeline={t.pipeline} thin />
      <p className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-sm">
        {a.alert && (
          <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
            <CircleAlertIcon aria-hidden className="size-3.5 shrink-0" />
            {a.alert}
          </span>
        )}
        {a.text && (
          <span className="text-muted-foreground">
            {a.alert && "· "}
            {a.text}
          </span>
        )}
      </p>
    </article>
  );
}
