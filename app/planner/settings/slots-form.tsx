"use client";

import { useState, useTransition } from "react";
import { useSyncedState } from "./use-synced-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { savePlannerSlots } from "@/app/actions/settings";
import { SLOT_DEFS, SLOTS, type Slot, type SlotColumn, type SlotMapping } from "@/lib/planner";

export function SlotsForm({ trackId, trackName, initial, choices }: { trackId: number; trackName: string; initial: SlotMapping; choices: Record<Slot, SlotColumn[]> }) {
  const [slots, setSlots] = useSyncedState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const r = await savePlannerSlots(trackId, slots);
        if (r.ok) setSaved(true);
        else setError(r.error);
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-card p-3">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{trackName}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {SLOTS.map((slot) => (
            <div key={slot} className="flex flex-col gap-1.5">
              <Label htmlFor={`slot-${trackId}-${slot}`} className="text-muted-foreground">{SLOT_DEFS[slot].label}</Label>
              <NativeSelect
                id={`slot-${trackId}-${slot}`}
                className="w-full"
                value={slots[slot] ?? ""}
                onChange={(e) => { setSlots((s) => ({ ...s, [slot]: e.target.value === "" ? null : Number(e.target.value) })); setSaved(false); }}
              >
                <NativeSelectOption value="">None</NativeSelectOption>
                {choices[slot].map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>{c.name}{c.hidden ? " (hidden)" : ""}</NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {saved && <p role="status" className="text-sm text-muted-foreground">Saved.</p>}
      </div>
    </form>
  );
}
