"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkBackup, fetchRestoreImpact, restoreBackup } from "@/app/actions/backup";
import type { BackupInfo } from "@/lib/files/restore";
import { createLatest } from "@/lib/latest";
import type { Counts } from "@/lib/restore";

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const summary = (c: Counts) => `${plural(c.applications, "application")}, ${plural(c.columns, "column")}, ${plural(c.files, "file")}, ${plural(c.submissions, "submission")} and ${plural(c.notes, "note")}`;
const when = (iso: string) => new Date(iso).toLocaleString();
const names = (p: string[]) => p.slice(0, 3).join(", ") + (p.length > 3 ? ` and ${p.length - 3} more` : "");
// Files the backup's database lists that are changed or absent in the zip: restored flagged, as Open would find them (not refused).
const flagged = (i: BackupInfo) => [
  ...(i.changed.length ? [`${plural(i.changed.length, "file")} will be restored flagged as changed (${names(i.changed)}): the backup holds ${i.changed.length === 1 ? "it" : "them"} as ${i.changed.length === 1 ? "it was" : "they were"}, not as uploaded.`] : []),
  ...(i.missing.length ? [`${plural(i.missing.length, "file")} will be restored flagged as missing (${names(i.missing)}): ${i.missing.length === 1 ? "it is" : "they are"} not in the backup.`] : []),
].join(" ");

type Impact = { ok: true; counts: Counts; destination: string | null } | { ok: false; error: string };
type Done = { safetyBackupPath: string; createdAt: string; counts: Counts; warnings: string[] };

// Two steps, as in the Files form: Check backup reads and validates the zip and changes nothing; Restore opens the confirm, which states
// what is replaced (counted fresh on every open, DESIGN.md) and sends those counts back so the server refuses if they changed.
export function RestoreForm({ destination }: { destination: string | null }) {
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState<{ path: string; info: BackupInfo } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<Impact | null>(null); // null while loading
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [latest] = useState(createLatest);
  const [checking, startCheck] = useTransition();
  const [restoring, startRestore] = useTransition();
  const doneRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (done) doneRef.current?.focus(); }, [done]); // the Restore button is gone: keep focus on the result

  function check(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    setChecked(null);
    startCheck(async () => {
      try {
        const r = await checkBackup(value);
        if (r.ok) setChecked({ path: value, info: r.info });
        else setError(r.error);
      } catch {
        setError("The check failed. Try again.");
      }
    });
  }

  function loadImpact() {
    setImpact(null);
    const token = latest.start();
    fetchRestoreImpact().then(
      (r) => latest.current(token) && setImpact(r),
      () => latest.current(token) && setImpact({ ok: false, error: "Could not count your data. Try again." }),
    );
  }

  function confirm() {
    if (!checked || !impact?.ok) return;
    setRestoreError(null);
    startRestore(async () => {
      try {
        const r = await restoreBackup(checked.path, { createdAt: checked.info.createdAt, counts: impact.counts });
        if (r.ok) {
          setOpen(false);
          setChecked(null);
          setValue("");
          setDone(r);
        } else {
          setRestoreError(r.error);
          loadImpact(); // a changed count: show the fresh one before the confirm asks again
        }
      } catch {
        setRestoreError("The restore failed. Try again.");
      }
    });
  }

  const info = checked?.info;
  return (
    <div className="mt-6 flex flex-col gap-2">
      <h3 id="restore" className="text-base font-semibold">Restore from a backup</h3>
      <form onSubmit={check} className="flex flex-col gap-2">
        <Label htmlFor="restore-path">Backup zip</Label>
        <div className="flex gap-2">
          <Input
            id="restore-path"
            value={value}
            onChange={(e) => { setValue(e.target.value); setChecked(null); setError(null); }}
            placeholder="/home/you/Backups/dossier-backup-20261110-1432.zip"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "restore-path-err" : undefined}
          />
          <Button type="submit" variant="outline" disabled={checking}>{checking ? "Checking…" : "Check backup"}</Button>
        </div>
        {error && <p id="restore-path-err" role="alert" className="text-sm text-destructive">{error}</p>}
        {checking && <p role="status" className="text-sm text-muted-foreground">Reading the backup and checking every file. A large backup takes a while.</p>}
      </form>

      {info && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm">
          <p role="status">
            Backup made <time dateTime={info.createdAt}>{when(info.createdAt)}</time>: {summary(info.counts)}. The zip holds {plural(info.fileCount, "file")} ({fmtSize(info.filesBytes)}).
            {flagged(info) ? ` ${flagged(info)}` : " Every file the backup's database lists is in it and matches its checksum."}
            {info.extraFiles > 0 && ` ${plural(info.extraFiles, "file")} in it ${info.extraFiles === 1 ? "is" : "are"} not listed in the database; they are restored as they are.`}
            {info.schemaOlder && " It is from an older version of Dossier and is upgraded while restoring."}
          </p>
          <div>
            <ConfirmDialog
              open={open}
              onOpenChange={(o) => {
                if (o) {
                  setRestoreError(null);
                  loadImpact();
                }
                setOpen(o);
              }}
              trigger={<Button type="button" variant="outline" disabled={restoring} className="border-destructive text-destructive hover:text-destructive">Restore…</Button>}
              title="Replace all your data with this backup?"
              description={
                impact === null ? (
                  "Counting your data…"
                ) : impact.ok ? (
                  <>
                    This replaces <strong>all</strong> of Dossier with the backup made on {when(info.createdAt)}. You will lose what is in Dossier now: {summary(impact.counts)}. They are replaced by the backup&apos;s {summary(info.counts)}.{" "}
                    {flagged(info) && <>{flagged(info)}{" "}</>}
                    {info.fileCount > 0 ? "Everything in your files folder is replaced by the backup's files." : "The backup holds no files, so your files folder is left as it is."}{" "}
                    {impact.destination
                      ? <>Before anything is replaced, Dossier saves a safety backup of your current data to <code className="break-all">{impact.destination}</code>; if that fails, nothing changes.</>
                      : "Save a backup folder first: Dossier saves a safety backup of your current data there before it replaces anything."}{" "}
                    Your files folder, backup folder and reminder settings stay as they are. This cannot be undone, except by restoring the safety backup.
                  </>
                ) : (
                  <span role="alert" className="text-destructive">{impact.error}</span>
                )
              }
              error={restoreError}
              confirmLabel="Replace everything"
              busyLabel="Restoring…"
              confirmDisabled={!impact?.ok || !impact.destination}
              busy={restoring}
              onConfirm={confirm}
            />
          </div>
          {!destination && <p className="text-muted-foreground">Save a backup folder above first: a restore needs it for the safety backup.</p>}
        </div>
      )}

      {done && (
        <div ref={doneRef} tabIndex={-1} role="status" className="flex flex-col gap-1 text-sm outline-none">
          <p>
            Restored the backup made on {when(done.createdAt)}: {summary(done.counts)}. Your previous data was saved first to <code className="rounded bg-muted px-1.5 py-0.5 break-all">{done.safetyBackupPath}</code>.
          </p>
          {done.warnings.map((w) => <p key={w} className="text-muted-foreground">{w}</p>)}
        </div>
      )}
    </div>
  );
}
