"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { archiveApplication, deleteApplication, fetchDeleteImpact } from "@/app/actions/application-state";
import { createLatest } from "@/lib/latest";

type Impact = Awaited<ReturnType<typeof fetchDeleteImpact>>;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// Archive needs no confirmation (one click undoes it), so it is a neutral outline button. Delete opens a confirm that states what will be lost,
// counted fresh on every open (DESIGN.md "Destructive confirms").
export function ApplicationActions({ id, archived }: { id: number; archived: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null); // null while loading
  const [delError, setDelError] = useState<string | null>(null);
  const [done, setDone] = useState<{ trackId: number; warning: string } | null>(null); // deleted, but files were left: show it before leaving
  const [latest] = useState(createLatest); // a late count from an earlier open must not replace the current one
  const [pending, startTransition] = useTransition();

  function loadImpact() {
    setImpact(null);
    const token = latest.start();
    fetchDeleteImpact(id).then(
      (r) => latest.current(token) && setImpact(r),
      () => latest.current(token) && setImpact({ ok: false, error: "Could not load the count. Try again." }),
    );
  }

  function archive() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await archiveApplication(id, !archived);
        if (!r.ok) setError(r.error);
      } catch {
        setError("Could not complete. Try again.");
      }
    });
  }

  function confirmDelete() {
    if (!impact?.ok) return;
    const expected = { cellCount: impact.cellCount, fileCount: impact.fileCount, submissionCount: impact.submissionCount, noteCount: impact.noteCount };
    setDelError(null);
    startTransition(async () => {
      try {
        const r = await deleteApplication(id, true, expected);
        if (r.ok && "warning" in r) {
          setDone({ trackId: r.trackId, warning: r.warning });
        } else if (r.ok) {
          setOpen(false);
          router.push(`/tracks/${r.trackId}`);
        } else {
          // Refused (e.g. a value was added meanwhile): show the fresh count before confirm re-enables.
          setDelError(r.error);
          loadImpact();
        }
      } catch {
        setDelError("Could not delete. Try again.");
      }
    });
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
      <Button type="button" variant="outline" disabled={pending} onClick={archive}>
        {archived ? "Unarchive" : "Archive"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          if (done) return router.push(`/tracks/${done.trackId}`); // any way of closing leaves the deleted application
          if (o) {
            setDelError(null);
            loadImpact();
          }
          setOpen(o);
        }}
        trigger={<Button type="button" variant="outline" disabled={pending} className="border-destructive text-destructive hover:text-destructive">Delete…</Button>}
        title={done ? "Application deleted" : "Delete this application?"}
        description={
          done ? (
            done.warning
          ) : impact === null ? (
            "Counting values…"
          ) : impact.ok ? (
            <>This permanently deletes <strong>{impact.title}</strong>, its {plural(impact.cellCount, "filled cell value")}, {plural(impact.fileCount, "file")}, {plural(impact.submissionCount, "submission")} and {plural(impact.noteCount, "note")}.{impact.fileCount > 0 && " The files are also removed from the files folder on disk."} This cannot be undone.</>
          ) : (
            <span role="alert" className="text-destructive">{impact.error}</span>
          )
        }
        error={delError}
        confirmLabel={done ? "Back to the track" : "Delete permanently"}
        busyLabel="Deleting…"
        confirmDisabled={!impact?.ok}
        busy={pending}
        onConfirm={done ? () => router.push(`/tracks/${done.trackId}`) : confirmDelete}
      />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
