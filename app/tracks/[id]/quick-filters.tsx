"use client";

import { OptionChip } from "@/app/option-chip";
import type { ApplicationRow } from "@/lib/db/applications";
import type { ColumnItem } from "@/lib/db/columns";
import { toggleFilter, type Filter } from "@/lib/filter";
import { optionCounts } from "@/lib/quick-filter";
import { cn } from "@/lib/utils";

const btn = "inline-flex h-7 items-center gap-1.5 rounded-full border px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

// One row of toggle chips per quick column (Status, Priority): "All" clears that column's filter, a chip toggles its option via toggleFilter.
// Counts ignore the column's own filter but respect the others (lib/quick-filter.ts). `columns` is every single-select column (the filter scope).
export function QuickFilters({ quick, columns, rows, filters, onChange }: {
  quick: ColumnItem[];
  columns: ColumnItem[];
  rows: ApplicationRow[];
  filters: Filter[];
  onChange: (next: Filter[]) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-2">
      {quick.map((c) => {
        const counts = optionCounts(rows, columns, filters, c);
        const active = filters.find((f) => f.id === c.id);
        return (
          <div key={c.id} role="group" aria-label={`Quick filter: ${c.name}`} className="flex min-w-0 flex-wrap items-center gap-1">
            <span className="mr-1 text-xs font-medium text-muted-foreground">{c.name}</span>
            <button
              type="button"
              aria-pressed={!active}
              onClick={() => onChange(filters.filter((f) => f.id !== c.id))}
              className={cn(btn, "font-medium", active ? "border-transparent text-muted-foreground hover:bg-muted" : "border-foreground bg-muted text-foreground")}
            >
              All
            </button>
            {c.options.map((o) => {
              const on = active?.options.includes(o.id) ?? false;
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${o.label}, ${counts.get(o.id)} ${counts.get(o.id) === 1 ? "application" : "applications"}`}
                  onClick={() => onChange(toggleFilter(filters, c.id, o.id))}
                  className={cn(btn, on ? "border-foreground bg-muted" : "border-transparent hover:bg-muted")}
                >
                  <OptionChip option={o} />
                  <span className="text-muted-foreground tabular-nums">{counts.get(o.id)}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
