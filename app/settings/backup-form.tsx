"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { backUpNow, saveBackupDestination } from "@/app/actions/backup";
import type { BackupResult } from "@/lib/files/backup";

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

export function BackupForm({ current }: { current: string | null }) {
  const [value, setValue] = useState(current ?? "");
  const [saved, setSaved] = useState(current); // what "Back up now" will use
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<BackupResult | null>(null);
  const [saving, startSave] = useTransition();
  const [backing, startBackup] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);
    setResult(null);
    startSave(async () => {
      try {
        const r = await saveBackupDestination(value);
        if (r.ok) {
          setValue(r.path);
          setSaved(r.path);
          setNote("Saved.");
        } else {
          setError(r.error);
        }
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  function run() {
    setError(null);
    setNote(null);
    setResult(null);
    startBackup(async () => {
      try {
        setResult(await backUpNow());
      } catch {
        setResult({ ok: false, error: "The backup failed. Try again." });
      }
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-4">
      <form onSubmit={save} className="flex flex-col gap-2">
        <Label htmlFor="backup-dest">Backup folder</Label>
        <div className="flex gap-2">
          <Input
            id="backup-dest"
            value={value}
            onChange={(e) => { setValue(e.target.value); setNote(null); }}
            placeholder="/home/you/Backups"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "backup-dest-err" : undefined}
          />
          <Button type="submit" variant="outline" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
        {error && <p id="backup-dest-err" role="alert" className="text-sm text-destructive">{error}</p>}
        {note && <p role="status" className="text-sm text-muted-foreground">{note}</p>}
      </form>
      <div className="flex flex-col gap-2">
        <div>
          <Button type="button" onClick={run} disabled={backing}>{backing ? "Backing up…" : "Back up now"}</Button>
        </div>
        {result && !result.ok && <p role="alert" className="text-sm text-destructive">{result.error}</p>}
        {result?.ok && (
          <p role="status" className="text-sm">
            Backup saved to <code className="rounded bg-muted px-1.5 py-0.5 break-all">{result.path}</code> ({fmtSize(result.sizeBytes)}, {new Date(result.createdAt).toLocaleString()}).
          </p>
        )}
        {backing && <p role="status" className="text-sm text-muted-foreground">Backing up…</p>}
        {!saved && !result && <p className="text-sm text-muted-foreground">Save a backup folder first: Back up now uses the saved folder.</p>}
      </div>
    </div>
  );
}
