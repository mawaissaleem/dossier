"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useEffect, useId, useState, type RefObject } from "react";
import { confirmSubmittedStatus, fetchReviewFiles, type ReviewFile } from "@/app/actions/submissions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useReturnFocus } from "@/components/use-return-focus";
import { submissionWarnings } from "@/lib/expected-labels";
import { todayLocal } from "@/lib/filename";

// What a status change hands to the review (FR-7.2). Every place that changes a status (table select, detail form, later the board in
// phase 9) opens it through useSubmissionReview when the server answers `needsReview`; nothing is saved until the user confirms.
export type ReviewRequest = {
  applicationId: number;
  columnId: number; // the status column
  optionId: number; // the submitted status being moved to
  statusLabel: string;
  onSaved?: () => void | Promise<void>; // after status + submission were saved (the server already refreshed the page)
  onCancel?: () => void; // closed without saving: put the control back to the old value
};

// One hook for every status-change surface. Render `dialog` once next to the control (outside any <form>: React events bubble through portals).
// `fallback` gets focus on close when nothing usable had it (the detail form's Save button is disabled while it checks with the server).
export function useSubmissionReview(fallback?: RefObject<HTMLElement | null>) {
  const [request, setRequest] = useState<ReviewRequest | null>(null); // kept after close, so the exit animation still has its text
  const [open, setOpen] = useState(false);
  const focus = useReturnFocus(fallback);
  return {
    review: (r: ReviewRequest) => {
      focus.remember();
      setRequest(r);
      setOpen(true);
    },
    dialog: request && <SubmissionReviewDialog request={request} open={open} onOpenChange={setOpen} onCloseAutoFocus={focus.onCloseAutoFocus} />,
  };
}

function SubmissionReviewDialog({ request, open, onOpenChange, onCloseAutoFocus }: {
  request: ReviewRequest; open: boolean; onOpenChange: (open: boolean) => void; onCloseAutoFocus: (e: Event) => void;
}) {
  const [busy, setBusy] = useState(false);
  // Escape and Cancel are ignored while saving, so a late result never lands on a closed dialog. Closing without saving = cancel.
  function close(saved: boolean) {
    if (busy) return;
    if (!saved) request.onCancel?.();
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close(false)}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg" onCloseAutoFocus={onCloseAutoFocus} onInteractOutside={(e) => e.preventDefault()}>
        {/* Mounted only while open, so each open starts clean and loads the current files. */}
        <ReviewForm request={request} busy={busy} setBusy={setBusy} onClose={close} />
      </DialogContent>
    </Dialog>
  );
}

function ReviewForm({ request, busy, setBusy, onClose }: { request: ReviewRequest; busy: boolean; setBusy: (b: boolean) => void; onClose: (saved: boolean) => void }) {
  const uid = useId();
  const [files, setFiles] = useState<ReviewFile[] | null>(null); // null = loading
  const [expected, setExpected] = useState<string[]>([]); // the track's expected labels (FR-7.3)
  const [ackedFor, setAckedFor] = useState<string | null>(null); // the warnings the user agreed to; any change in them asks again
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [date, setDate] = useState(() => todayLocal()); // this component mounts only after a click, so the browser's local date is safe here
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchReviewFiles(request.applicationId)
      .then((r) => {
        if (!live) return;
        if (r.ok) { setFiles(r.files); setExpected(r.expectedLabels); setPicked(new Set(r.files.map((f) => f.id))); } // all checked by default
        else setError(r.error);
      })
      .catch(() => live && setError("Could not load the files. Close this and try again."));
    return () => { live = false; };
  }, [request.applicationId]);

  // Warnings follow the ticked files, so unticking the CV warns at once. With warnings, Confirm needs the "Submit anyway" tick.
  const warnings = files === null ? [] : submissionWarnings(files.filter((f) => picked.has(f.id)).map((f) => f.label), expected);
  const acked = ackedFor === warnings.join("\n");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || files === null || (warnings.length > 0 && !acked)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await confirmSubmittedStatus(request.applicationId, request.columnId, request.optionId, files.filter((f) => picked.has(f.id)).map((f) => f.id), date, note.trim() || null);
      if (!r.ok) { setError(r.error); setBusy(false); return; }
    } catch {
      setError("Could not save. Try again.");
      setBusy(false);
      return;
    }
    setBusy(false);
    onClose(true);
    await request.onSaved?.();
  }

  const toggle = (id: number, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  return (
    <form onSubmit={submit} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <DialogHeader>
        <DialogTitle>Review submission</DialogTitle>
        <DialogDescription>
          Moving to {request.statusLabel} saves the first submission with the files you keep ticked. Nothing is saved until you confirm.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-date`}>Date sent</Label>
        <Input id={`${uid}-date`} type="date" required value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} aria-invalid={error?.startsWith("Use a real date") ? true : undefined} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-note`}>Note (optional)</Label>
        <Textarea id={`${uid}-note`} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} rows={2} />
      </div>
      {/* Files come after Date and Note so Tab runs date, note, files, Confirm (the date takes the initial focus before the files load). */}
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Files</legend>
        {files === null && !error && <p role="status" className="text-sm text-muted-foreground">Loading files…</p>}
        {files?.length === 0 && <p className="text-sm text-muted-foreground">No files are attached to this application.</p>}
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
      {warnings.length > 0 && (
        <>
          <div role="status" className="flex gap-2 rounded-md border border-warning bg-muted p-3 text-sm">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <ul className="min-w-0 break-words">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id={`${uid}-ack`} checked={acked} onCheckedChange={(c) => setAckedFor(c === true ? warnings.join("\n") : null)} disabled={busy} />
            <Label htmlFor={`${uid}-ack`}>Submit anyway</Label>
          </div>
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={() => onClose(false)}>Cancel</Button>
        <Button type="submit" disabled={busy || files === null || (warnings.length > 0 && !acked)}>{busy ? "Saving…" : "Confirm submission"}</Button>
      </DialogFooter>
    </form>
  );
}
