"use client";

import { useState, useTransition } from "react";
import { useSyncedState } from "./use-synced-state";
import { OptionChip } from "@/app/option-chip";
import { saveOptionBuffer } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SLOT_DEFS, parseBufferInput } from "@/lib/planner";
import type { BufferOption, BufferSlot, PlannerBuffers } from "@/lib/db/planner";

// Text, not number: a number input reports "" for unparseable text, which would save as blank.
// One form per option, each with its own Save: a save changes exactly one option, so there is no half-saved card.
function BufferRow({ slot, option }: { slot: BufferSlot; option: BufferOption }) {
  const [value, setValue] = useSyncedState(option.bufferDays === null ? "" : String(option.bufferDays));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const id = `buffer-${option.id}`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const r = await saveOptionBuffer(option.id, parseBufferInput(value));
        if (r.ok) setSaved(true);
        else setError(r.error);
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  return (
    <li>
      <form onSubmit={submit} noValidate className="flex flex-wrap items-center gap-2">
        <span className="w-40 shrink-0"><OptionChip option={option} /></span>
        <Label htmlFor={id} className="sr-only">Buffer days for {SLOT_DEFS[slot].label}: {option.label}</Label>
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          placeholder="0"
          className="max-w-24"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); setError(null); }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
        />
        <span className="text-sm text-muted-foreground">days</span>
        <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {error && <p id={`${id}-err`} role="alert" className="text-sm text-destructive">{error}</p>}
        {saved && <p role="status" className="text-sm text-muted-foreground">Saved.</p>}
      </form>
    </li>
  );
}

export function BuffersForm({ trackName, buffers }: { trackName: string; buffers: PlannerBuffers }) {
  return (
    <div role="group" aria-label={`${trackName} buffers`} className="rounded-lg border border-border bg-card p-3">
      <p className="mb-2 text-sm font-medium">{trackName}</p>
      <div className="flex flex-col gap-4">
        {(["priority", "effort"] as const).map((slot) => {
          const b = buffers[slot];
          const label = SLOT_DEFS[slot].label;
          return (
            <div key={slot}>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">{label}{b && b.column.trim().toLowerCase() !== label.toLowerCase() ? ` (${b.column})` : ""}</p>
              {!b ? (
                <p className="text-sm text-muted-foreground">No {label} column chosen in Engine slots.</p>
              ) : b.options.length === 0 ? (
                <p className="text-sm text-muted-foreground">This column has no options yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">{b.options.map((o) => <BufferRow key={o.id} slot={slot} option={o} />)}</ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
