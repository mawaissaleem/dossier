"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { updateCell } from "@/app/actions/cells";
import type { OptionItem } from "@/lib/db/columns";
import { chipClasses } from "@/lib/colors";
import { findOption } from "@/lib/options";

// Native <select> (full keyboard support), styled as the chosen option's chip. One updateCell call per change; blank clears.
// useOptimistic shows the new choice while saving and reverts by itself if the save fails (props stay the same).
export function SelectCell({ applicationId, columnId, value, options, label }: {
  applicationId: number; columnId: number; value: string | number | boolean | null | undefined; options: OptionItem[]; label: string;
}) {
  const current = findOption(options, value); // an id that is not in the list shows as blank
  const [shown, setShown] = useOptimistic(current?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Set synchronously: a second change can land before a re-render, so state alone would not block it.
  const locked = useRef(false);

  function choose(value: string) {
    if (locked.current) return; // a change while a save is in flight is ignored (the select goes back to what is shown)
    locked.current = true;
    setError(null);
    startTransition(async () => {
      setShown(value === "" ? null : Number(value));
      try {
        const r = await updateCell(applicationId, columnId, value === "" ? null : Number(value));
        if (!r.ok) setError(r.error);
      } catch {
        setError("Could not save. Try again.");
      } finally {
        locked.current = false;
      }
    });
  }

  if (options.length === 0) {
    return (
      <select aria-label={label} disabled className="text-sm text-foreground/60">
        <option>No options yet</option>
      </select>
    );
  }
  const color = findOption(options, shown)?.color;
  return (
    <>
      <select
        aria-label={label}
        value={shown === null ? "" : String(shown)}
        onChange={(e) => choose(e.target.value)}
        className={`rounded-full px-2 py-0.5 text-sm ${color ? chipClasses(color) : "border border-foreground/30"}`}
      >
        <option value="">— (blank)</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </>
  );
}
