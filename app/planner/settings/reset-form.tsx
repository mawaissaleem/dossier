"use client";

import { useState, useTransition } from "react";
import { resetPlanner } from "@/app/actions/settings";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useResetEpoch } from "./reset-epoch";

export function ResetForm() {
  const { bump } = useResetEpoch();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await resetPlanner();
        if (r.ok) {
          bump(); // remount the forms with the refreshed defaults
          setDone(true);
          setOpen(false);
        } else setError(r.error);
      } catch {
        setError("Could not reset. Nothing was changed.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => { if (o) { setError(null); setDone(false); } setOpen(o); }}
        trigger={<Button type="button" variant="outline" className="border-destructive text-destructive hover:text-destructive">Reset to defaults…</Button>}
        title="Reset planner settings to defaults?"
        description="This resets engine slots, buffers, still-to-do statuses, ranking rules and weekly capacity for every track to the shipped defaults. Your applications, columns and other settings are not changed."
        error={error}
        confirmLabel="Reset to defaults"
        busyLabel="Resetting…"
        busy={pending}
        onConfirm={confirm}
      />
      {done && <p role="status" className="text-sm text-muted-foreground">Planner settings reset.</p>}
    </div>
  );
}
