"use client";

import { useState, useTransition } from "react";
import { useSyncedState } from "./use-synced-state";
import { Button } from "@/components/ui/button";
import { saveRankingRules } from "@/app/actions/settings";
import type { NoDeadlinePolicy, OverduePolicy } from "@/lib/planner";

type Choice<T extends string> = { value: T; label: string; hint: string };

const OVERDUE: Choice<OverduePolicy>[] = [
  { value: "pin", label: "Pin to top and flag", hint: "Overdue applications come first, flagged as overdue, most urgent first." },
  { value: "hide", label: "Hide", hint: "Overdue applications are left out of the ranking." },
  { value: "normal", label: "Rank normally", hint: "Overdue applications are ranked by their score like any other, with no flag." },
];

const NO_DEADLINE: Choice<NoDeadlinePolicy>[] = [
  { value: "stale", label: "Rank by time since last touched", hint: "After every dated application, the one untouched the longest comes first. Any change to the application counts as touching it: edits, status changes, uploads, submissions and notes." },
  { value: "last", label: "Rank last", hint: "After every dated application, those with bigger priority and effort buffers come first." },
  { value: "ignore", label: "Leave out", hint: "Applications with no deadline are not ranked." },
];

function Group<T extends string>({ name, legend, choices, value, onChange }: { name: string; legend: string; choices: Choice<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {choices.map((c) => (
        <label key={c.value} className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={c.value}
            checked={value === c.value}
            onChange={() => onChange(c.value)}
            className="mt-0.5 size-4 shrink-0 rounded-full accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="flex flex-col">
            <span className="text-foreground">{c.label}</span>
            <span className="text-muted-foreground">{c.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function RulesForm({ initial }: { initial: { overdue: OverduePolicy; noDeadline: NoDeadlinePolicy } }) {
  const [overdue, setOverdue] = useSyncedState(initial.overdue);
  const [noDeadline, setNoDeadline] = useSyncedState(initial.noDeadline);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const r = await saveRankingRules(overdue, noDeadline);
        if (r.ok) setSaved(true);
        else setError(r.error);
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-3">
      <Group name="overdue" legend="Overdue" choices={OVERDUE} value={overdue} onChange={(v) => { setOverdue(v); setSaved(false); }} />
      <Group name="no-deadline" legend="No deadline" choices={NO_DEADLINE} value={noDeadline} onChange={(v) => { setNoDeadline(v); setSaved(false); }} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {saved && <p role="status" className="text-sm text-muted-foreground">Saved.</p>}
      </div>
    </form>
  );
}
