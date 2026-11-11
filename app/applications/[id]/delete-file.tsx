"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";
import { deleteFile, fetchFileDeleteImpact } from "@/app/actions/files";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { formatYmd } from "@/lib/history";
import { createLatest } from "@/lib/latest";
import { formatBytes } from "@/lib/upload-client";

type Impact = Awaited<ReturnType<typeof fetchFileDeleteImpact>>;

// "Delete…" on a file row (FR-5.8): confirm, then (only when a submission lists the file) a second deliberate step, the "I understand" tick,
// then remove. The impact is fetched each time the dialog opens (DESIGN.md "One rule for every destructive confirm").
export function DeleteFile({ id, name }: { id: number; name: string }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<Impact | null>(null); // null while loading
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest] = useState(createLatest);
  const gone = useRef(false); // deleted: Cancel and Escape still return focus to the Delete button, a finished delete must not
  const [pending, startTransition] = useTransition();

  function load() {
    setImpact(null);
    setUnderstood(false);
    const token = latest.start();
    fetchFileDeleteImpact(id).then(
      (r) => latest.current(token) && setImpact(r),
      () => latest.current(token) && setImpact({ ok: false, error: "Could not load the details. Try again." }),
    );
  }

  const subs = impact?.ok ? impact.submissions : [];
  const needsTick = subs.length > 0;

  function confirm() {
    if (!impact?.ok || (needsTick && !understood)) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await deleteFile(id, true, subs.length);
        if (r.ok) {
          gone.current = true;
          setOpen(false);
          document.getElementById("files")?.focus(); // this row is gone, so focus would be lost
        } else {
          setError(r.error);
          load(); // the fresh impact, so the next confirm states what is true now
        }
      } catch {
        setError("Could not delete the file. Try again.");
      }
    });
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (o) { gone.current = false; setError(null); load(); }
        setOpen(o);
      }}
      trigger={<Button type="button" variant="outline" size="sm" aria-label={`Delete ${name}`} className="border-destructive text-destructive hover:text-destructive">Delete…</Button>}
      title="Delete this file?"
      description={
        impact === null ? (
          "Loading the details…"
        ) : impact.ok ? (
          <>This permanently deletes <strong className="break-all">{impact.originalName}</strong> ({impact.label}, {formatBytes(impact.sizeBytes)}, stored as <code className="break-all">{impact.storedName}</code>) from the files folder on disk. This cannot be undone.</>
        ) : (
          <span role="alert" className="text-destructive">{impact.error}</span>
        )
      }
      error={error}
      confirmLabel="Delete file"
      busyLabel="Deleting…"
      confirmDisabled={!impact?.ok || (needsTick && !understood)}
      busy={pending}
      onConfirm={confirm}
      onCloseAutoFocus={(e) => gone.current && e.preventDefault()}
    >
      {needsTick && (
        <>
          <div role="status" className="flex gap-2 rounded-md border border-warning bg-muted p-3 text-sm">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0">
              <p>This file was sent in {subs.length === 1 ? "1 submission" : `${subs.length} submissions`}: {subs.map((s) => formatYmd(s.date)).join(", ")}.</p>
              <p className="mt-1">Those submissions keep the file&apos;s name, label, size and checksum as a record, marked Deleted, but the file itself will be gone and cannot be opened or downloaded again.</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id={`${uid}-ack`} className="mt-0.5" checked={understood} onCheckedChange={(c) => setUnderstood(c === true)} disabled={pending} />
            <Label htmlFor={`${uid}-ack`} className="leading-5">I understand the file will be gone for good.</Label>
          </div>
        </>
      )}
    </ConfirmDialog>
  );
}
