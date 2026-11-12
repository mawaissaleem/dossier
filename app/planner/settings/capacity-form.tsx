"use client";

import { useState, useTransition } from "react";
import { useSyncedState } from "./use-synced-state";
import { saveCapacity } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_CAPACITY, MIN_CAPACITY, parseCapacityInput } from "@/lib/planner";

// Text, not number (same reason as the buffer field): a number input reports "" for unparseable text.
export function CapacityForm({ initial }: { initial: number }) {
  const [value, setValue] = useSyncedState(String(initial));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const r = await saveCapacity(parseCapacityInput(value));
        if (r.ok) setSaved(true);
        else setError(r.error);
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
      <Label htmlFor="capacity-input">Applications per week ({MIN_CAPACITY} to {MAX_CAPACITY})</Label>
      <Input
        id="capacity-input"
        type="text"
        inputMode="numeric"
        className="max-w-24"
        value={value}
        onChange={(e) => { setValue(e.target.value); setSaved(false); setError(null); }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "capacity-err" : undefined}
      />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      {error && <p id="capacity-err" role="alert" className="text-sm text-destructive">{error}</p>}
      {saved && <p role="status" className="text-sm text-muted-foreground">Saved.</p>}
    </form>
  );
}
