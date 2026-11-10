"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveReminderDays } from "@/app/actions/backup";
import { MAX_REMINDER_DAYS, MIN_REMINDER_DAYS } from "@/lib/backup-reminder";

export function ReminderForm({ current }: { current: number }) {
  const [value, setValue] = useState(String(current));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const r = await saveReminderDays(value);
        if (r.ok) {
          setValue(String(r.days));
          setSaved(true);
        } else {
          setError(r.error);
        }
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-2">
      <Label htmlFor="backup-days">Remind me after (days)</Label>
      <div className="flex gap-2">
        <Input
          id="backup-days"
          type="number"
          inputMode="numeric"
          min={MIN_REMINDER_DAYS}
          max={MAX_REMINDER_DAYS}
          step={1}
          className="max-w-28"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "backup-days-err" : undefined}
        />
        <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      </div>
      {error && <p id="backup-days-err" role="alert" className="text-sm text-destructive">{error}</p>}
      {saved && <p role="status" className="text-sm text-muted-foreground">Saved.</p>}
    </form>
  );
}
