"use client";

import { useState, useTransition } from "react";
import { OptionChip } from "@/app/option-chip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { saveSubmittedStatuses, saveWinStatuses } from "@/app/actions/settings";

type Choice = { id: number; label: string; color: string; on: boolean };

// One checkbox per status option; also used for the dashboard "win" statuses (`kind="win"`, FR-9.7), which are saved
// the same way.
export function SubmittedForm({
  trackId,
  trackName,
  choices,
  kind = "submitted",
}: {
  trackId: number;
  trackName: string;
  choices: Choice[];
  kind?: "submitted" | "win";
}) {
  const [on, setOn] = useState(() => new Set(choices.filter((c) => c.on).map((c) => c.id)));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(id: number, checked: boolean) {
    setOn((s) => {
      const n = new Set(s);
      if (checked) n.add(id);
      else n.delete(id);
      return n;
    });
    setSaved(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const r = await (kind === "win" ? saveWinStatuses : saveSubmittedStatuses)(trackId, [...on]);
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
        {choices.length === 0 ? (
          <p className="text-sm text-muted-foreground">This track has no status options.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {choices.map((c) => (
              <li key={c.id}>
                <label className="flex h-8 items-center gap-2 text-sm">
                  <Checkbox checked={on.has(c.id)} onCheckedChange={(v) => toggle(c.id, v === true)} />
                  <OptionChip option={c} />
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      {choices.length > 0 && (
        <div className="mt-2 flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {on.size === 0 && (
            <p className="text-sm text-muted-foreground">
              {kind === "win"
                ? `Nothing selected: ${trackName} adds nothing to Wins.`
                : `Nothing selected: no status will create a submission for ${trackName}.`}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="text-sm text-muted-foreground">
              Saved.
            </p>
          )}
        </div>
      )}
    </form>
  );
}
