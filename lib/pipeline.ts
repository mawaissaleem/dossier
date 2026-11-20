// Pure: pipeline counts per status (FR-9.6). No DB or UI imports.
export type PipelineOption = { id: number; label: string; color: string };
export type PipelineTrackInput = {
  id: number;
  name: string;
  color: string;
  statusColumnId: number | null;
  options: PipelineOption[];
};
// One grouped-query row: how many applications of the track hold this status option (null = no value).
export type PipelineRow = { trackId: number; optionId: number | null; n: number };
// token = the option id, or "blank" for "No status" (the same words the table's `?f=` filter uses). color null = no
// status (drawn with the muted token).
export type PipelineSegment = { token: number | "blank"; label: string; color: string | null; count: number };
export type TrackPipeline = {
  id: number;
  name: string;
  color: string;
  statusColumnId: number | null;
  segments: PipelineSegment[];
  total: number;
};

// Every status option in its configured order (zero counts kept, so the legend is stable), then "No status" only when >
// 0. A value that is no longer an option of the track counts as "No status" (the filter treats it as blank too). A
// track without a status column has no segments, only a total.
export function pipelineCounts(rows: readonly PipelineRow[], tracks: readonly PipelineTrackInput[]): TrackPipeline[] {
  return tracks.map((t) => {
    const byOption = new Map<number, number>();
    let blank = 0;
    let total = 0;
    const known = new Set(t.options.map((o) => o.id));
    for (const r of rows) {
      if (r.trackId !== t.id) continue;
      total += r.n;
      if (r.optionId !== null && known.has(r.optionId)) byOption.set(r.optionId, (byOption.get(r.optionId) ?? 0) + r.n);
      else blank += r.n;
    }
    if (t.statusColumnId === null)
      return { id: t.id, name: t.name, color: t.color, statusColumnId: null, segments: [], total };
    const segments: PipelineSegment[] = t.options.map((o) => ({
      token: o.id,
      label: o.label,
      color: o.color,
      count: byOption.get(o.id) ?? 0,
    }));
    if (blank > 0) segments.push({ token: "blank", label: "No status", color: null, count: blank });
    return { id: t.id, name: t.name, color: t.color, statusColumnId: t.statusColumnId, segments, total };
  });
}

// The text alternative of the bar: "Applied 3, Interview 1" (zero counts left out; "No applications" when empty).
export const pipelineSummary = (p: { total: number; segments: readonly { label: string; count: number }[] }): string =>
  p.total === 0
    ? "No applications"
    : p.segments
        .filter((s) => s.count > 0)
        .map((s) => `${s.label} ${s.count}`)
        .join(", ") || `${p.total} applications`;

export type CountedStatus = { label: string; color: string | null; count: number };

// The "Pipeline · all tracks" bar: every track's segments added up by label (Job's "Applied" and PhD's "Applied" are
// one entry), in order of first appearance, zero counts kept so the legend stays stable. A track without a status
// column counts its applications as "No status", so `total` is always what the bar shows. A label keeps the colour it
// first had.
export function allTracksPipeline(pipelines: readonly TrackPipeline[]): { segments: CountedStatus[]; total: number } {
  const byLabel = new Map<string, CountedStatus>();
  const add = (label: string, color: string | null, count: number) => {
    const seen = byLabel.get(label);
    if (seen) seen.count += count;
    else byLabel.set(label, { label, color, count });
  };
  for (const p of pipelines) {
    if (p.statusColumnId === null) {
      if (p.total > 0) add("No status", null, p.total);
      continue;
    }
    for (const s of p.segments) add(s.label, s.color, s.count);
  }
  const segments = [...byLabel.values()];
  return { segments, total: segments.reduce((n, s) => n + s.count, 0) };
}
