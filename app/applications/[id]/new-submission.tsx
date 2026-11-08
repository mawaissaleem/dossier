"use client";

import { InfoIcon, PlusIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { addSubmission, fetchReviewFiles, type ReviewFile } from "@/app/actions/submissions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { submissionWarnings } from "@/lib/expected-labels";
import { todayLocal } from "@/lib/filename";

export type StatusChoice = { columnId: number; name: string; currentOptionId: number | null; options: { id: number; label: string }[] };

// Manual "New submission" (FR-7.4): files, date, note and an optional status change, saved together. At least one file is required
// (no files = nothing to record). Missing expected labels (FR-7.3) are shown as information only: an extra transcript is not a full set.
// The trigger opens a dialog whose body mounts only while open, so each open starts clean and loads the current files.
export function NewSubmission({ applicationId, status }: { applicationId: number; status: StatusChoice | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  // Escape and Cancel are ignored while saving, so a late result never lands on a closed dialog.
  function onOpenChange(o: boolean) {
    if (busy) return;
    if (o) setSaved(false);
    setOpen(o);
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline"><PlusIcon aria-hidden />New submission</Button>
        </DialogTrigger>
        <DialogContent showCloseButton={false} className="sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
          <SubmissionForm applicationId={applicationId} status={status} busy={busy} setBusy={setBusy} onClose={(wasSaved) => { setSaved(wasSaved); setOpen(false); }} />
        </DialogContent>
      </Dialog>
      <p role="status" className="text-sm text-muted-foreground">{saved ? "Submission saved." : ""}</p>
    </div>
  );
}

function SubmissionForm({ applicationId, status, busy, setBusy, onClose }: {
  applicationId: number; status: StatusChoice | null; busy: boolean; setBusy: (b: boolean) => void; onClose: (saved: boolean) => void;
}) {
  const uid = useId();
  const [files, setFiles] = useState<ReviewFile[] | null>(null); // null = loading
  const [expected, setExpected] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set()); // none preselected: a new submission is usually a subset
  const [date, setDate] = useState(() => todayLocal()); // mounts only after a click, so the browser's local date is safe here
  const [note, setNote] = useState("");
  const [newStatus, setNewStatus] = useState(""); // "" = keep current
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchReviewFiles(applicationId)
      .then((r) => {
        if (!live) return;
        if (r.ok) { setFiles(r.files); setExpected(r.expectedLabels); }
        else setError(r.error);
      })
      .catch(() => live && setError("Could not load the files. Close this and try again."));
    return () => { live = false; };
  }, [applicationId]);

  const chosen = files?.filter((f) => picked.has(f.id)) ?? [];
  const warnings = chosen.length ? submissionWarnings(chosen.map((f) => f.label), expected) : []; // with no file ticked the button is disabled instead
  const canSave = !busy && chosen.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const r = await addSubmission(applicationId, chosen.map((f) => f.id), date, note.trim() || null, status && newStatus ? { columnId: status.columnId, optionId: Number(newStatus) } : null);
      if (!r.ok) { setError(r.error); setBusy(false); return; }
    } catch {
      setError("Could not save. Try again.");
      setBusy(false);
      return;
    }
    setBusy(false);
    onClose(true);
  }

  const toggle = (id: number, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const current = status?.options.find((o) => o.id === status.currentOptionId)?.label;
  return (
    <form onSubmit={submit} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <DialogHeader>
        <DialogTitle>New submission</DialogTitle>
        <DialogDescription>Record what you sent: tick at least one file. Nothing is saved until you confirm.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-date`}>Date sent</Label>
        <Input id={`${uid}-date`} type="date" required value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} aria-invalid={error?.startsWith("Use a real date") ? true : undefined} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-note`}>Note (optional)</Label>
        <Textarea id={`${uid}-note`} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} rows={2} aria-invalid={error?.startsWith("The note") ? true : undefined} />
      </div>
      {status && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-status`}>{status.name}</Label>
          <NativeSelect id={`${uid}-status`} className="w-full" value={newStatus} onChange={(e) => setNewStatus(e.target.value)} disabled={busy}>
            <NativeSelectOption value="">{current ? `Keep current (${current})` : "Keep current (empty)"}</NativeSelectOption>
            {status.options.filter((o) => o.id !== status.currentOptionId).map((o) => <NativeSelectOption key={o.id} value={o.id}>{o.label}</NativeSelectOption>)}
          </NativeSelect>
        </div>
      )}
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Files</legend>
        {files === null && !error && <p role="status" className="text-sm text-muted-foreground">Loading files…</p>}
        {files?.length === 0 && <p className="text-sm text-muted-foreground">This application has no files yet. Upload files first, then record the submission.</p>}
        {files && files.length > 0 && (
          <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <Checkbox id={`${uid}-f${f.id}`} checked={picked.has(f.id)} onCheckedChange={(c) => toggle(f.id, c === true)} disabled={busy} />
                <Label htmlFor={`${uid}-f${f.id}`} className="min-w-0 flex-1 flex-wrap gap-x-2 gap-y-1 leading-5">
                  <span title={f.originalName} className="max-w-full min-w-0 truncate">{f.originalName}</span>
                  <span title={f.label} className="max-w-32 shrink-0 truncate rounded-sm bg-muted px-1.5 text-xs leading-5 font-medium">{f.label}</span>
                  <time dateTime={f.uploadDate} className="shrink-0 text-xs font-normal text-muted-foreground">{f.uploadDate}</time>
                </Label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      {/* Always mounted, so a screen reader announces the text when it appears; hidden while empty. */}
      <div role="status" className="flex gap-2 rounded-md border border-border bg-muted p-3 text-sm empty:hidden">
        {warnings.length > 0 && (
          <>
            <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <ul className="min-w-0 break-words">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={() => onClose(false)}>Cancel</Button>
        <Button type="submit" disabled={!canSave}>{busy ? "Saving…" : "Save submission"}</Button>
      </DialogFooter>
    </form>
  );
}
