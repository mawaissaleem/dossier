"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchMoveImpact, moveFilesRoot, repointFilesRoot, saveFilesRoot } from "@/app/actions/settings";
import { createLatest } from "@/lib/latest";
import type { MoveResult } from "@/lib/files/relocate";

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

type Impact = { ok: true; fileCount: number; totalBytes: number; from: string | null } | { ok: false; error: string };

// No stored files yet: one Save, as before. Once files exist, a different folder is either Moved (Dossier moves the files, after a confirm that says
// how many) or Re-pointed (you already moved the folder yourself; Dossier checks every file is there first). Nothing here saves a path blindly.
export function FilesRootForm({ current, liveFiles }: { current: string | null; liveFiles: number }) {
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [moved, setMoved] = useState<Extract<MoveResult, { ok: true }> | null>(null);
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<Impact | null>(null); // null while loading
  const [moveError, setMoveError] = useState<string | null>(null);
  const [latest] = useState(createLatest);
  const [pending, startTransition] = useTransition();
  const [moving, startMove] = useTransition();

  const reset = () => { setError(null); setSaved(null); setMoved(null); };

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (liveFiles > 0) return; // Move and Re-point are separate buttons: Enter must not pick one
    reset();
    startTransition(async () => {
      try {
        const r = await saveFilesRoot(value);
        if (r.ok) {
          setValue(r.path);
          setSaved("Saved.");
        } else {
          setError(r.error);
        }
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  function repoint() {
    if (pending || moving) return; // aria-disabled, not disabled: a disabled button would drop keyboard focus to <body>
    reset();
    startTransition(async () => {
      try {
        const r = await repointFilesRoot(value);
        if (r.ok) {
          setValue(r.path);
          setSaved(`Saved. All ${plural(r.checked, "file")} were found there with the recorded size.`);
        } else {
          setError(r.error);
        }
      } catch {
        setError("Could not check that folder. Try again.");
      }
    });
  }

  function loadImpact() {
    setImpact(null);
    const token = latest.start();
    fetchMoveImpact().then(
      (r) => latest.current(token) && setImpact(r),
      () => latest.current(token) && setImpact({ ok: false, error: "Could not count your files. Try again." }),
    );
  }

  function confirmMove() {
    if (!impact?.ok) return;
    setMoveError(null);
    startMove(async () => {
      try {
        const r = await moveFilesRoot(value, { fileCount: impact.fileCount, totalBytes: impact.totalBytes });
        if (r.ok) {
          setOpen(false);
          setValue(r.path);
          setMoved(r);
        } else {
          setMoveError(r.error);
          loadImpact(); // a changed count: show the fresh one before the confirm asks again
        }
      } catch {
        setMoveError("The move failed. Your files folder was not changed. Try again.");
      }
    });
  }

  const errorProps = { "aria-invalid": error ? true : undefined, "aria-describedby": error ? "files-root-err" : undefined } as const;
  return (
    <form onSubmit={save} className="mt-3 flex flex-col gap-2">
      <Label htmlFor="files-root">{liveFiles > 0 ? "New files root folder" : "Files root folder"}</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="files-root"
          className="min-w-0 flex-1 basis-64"
          value={value}
          onChange={(e) => { setValue(e.target.value); reset(); }}
          placeholder="/home/you/Dossier"
          autoComplete="off"
          spellCheck={false}
          {...errorProps}
        />
        {liveFiles === 0 ? (
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        ) : (
          <>
            <ConfirmDialog
              open={open}
              onOpenChange={(o) => {
                if (o) { setMoveError(null); loadImpact(); }
                setOpen(o);
              }}
              trigger={<Button type="button" disabled={pending || moving || !current}>Move files…</Button>}
              title="Move your files to the new folder?"
              description={
                impact === null ? "Counting your files…" : impact.ok ? (
                  <>
                    Dossier moves {plural(impact.fileCount, "file")} ({fmtSize(impact.totalBytes)}) from <code className="break-all">{impact.from}</code> to <code className="break-all">{value.trim()}</code>, which must be empty.
                    On the same drive they are renamed; otherwise each is copied and checked against its checksum, and Dossier then <strong>removes the old copies</strong> from the old folder
                    (only files it stored; anything else there is left alone). The old folder itself stays. If any step fails, nothing changes. Do not upload or back up while it runs.
                  </>
                ) : <span role="alert" className="text-destructive">{impact.error}</span>
              }
              error={moveError}
              confirmLabel="Move files"
              busyLabel="Moving…"
              confirmDisabled={!impact?.ok}
              busy={moving}
              onConfirm={confirmMove}
            />
            <Button type="button" variant="outline" aria-disabled={pending || moving} onClick={repoint}>{pending ? "Checking…" : "Re-point"}</Button>
          </>
        )}
      </div>
      {liveFiles > 0 && (
        <p className="text-sm text-muted-foreground">
          {plural(liveFiles, "file")} stored. <strong className="font-medium text-foreground">Move files</strong> moves them into the empty folder named above.{" "}
          <strong className="font-medium text-foreground">Re-point</strong> is for a folder you already moved yourself: it saves the path only if every stored file is there with its recorded size.
        </p>
      )}
      {error && <p id="files-root-err" role="alert" className="text-sm text-destructive">{error}</p>}
      {pending && liveFiles > 0 && <p role="status" className="text-sm text-muted-foreground">Checking the files…</p>}
      {saved && <p role="status" className="text-sm text-muted-foreground">{saved}</p>}
      {moved && (
        <div role="status" className="flex flex-col gap-1 text-sm">
          <p>Moved {plural(moved.moved, "file")} ({fmtSize(moved.bytes)}) to <code className="rounded bg-muted px-1.5 py-0.5 break-all">{moved.path}</code>: {moved.renamed} renamed, {moved.copied} copied and checked. The files folder now points there.</p>
          {moved.warnings.map((w) => <p key={w} className="text-muted-foreground">{w}</p>)}
        </div>
      )}
    </form>
  );
}
