"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { updateCell } from "@/app/actions/cells";

// Native checkbox, one updateCell call per toggle. Unchecked is saved as false (not blank); a row with no value also shows unchecked.
// useOptimistic shows the new state while saving and reverts by itself if the save fails (props stay the same).
export function CheckboxCell({ applicationId, columnId, checked, label }: {
  applicationId: number; columnId: number; checked: boolean; label: string;
}) {
  const [shown, setShown] = useOptimistic(checked);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Set synchronously: a fast second click can land before a re-render, so state alone would not block it.
  const locked = useRef(false);

  function toggle(next: boolean) {
    if (locked.current) return; // toggle while a save is in flight is ignored (the box stays as shown)
    locked.current = true;
    setError(null);
    startTransition(async () => {
      setShown(next);
      try {
        const r = await updateCell(applicationId, columnId, next);
        if (!r.ok) setError(r.error);
      } catch {
        setError("Could not save. Try again.");
      } finally {
        locked.current = false;
      }
    });
  }

  return (
    <>
      <input type="checkbox" aria-label={label} checked={shown} onChange={(e) => toggle(e.target.checked)} />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </>
  );
}
