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
    const expected = { cellCount: impact.cellCount, fileCount: impact.fileCount };
    setDelError(null);
    startTransition(async () => {
      try {
        const r = await deleteApplication(id, true, expected);
        if (r.ok) {
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
          if (o) {
            setDelError(null);
            loadImpact();
          }
          setOpen(o);
        }}
        trigger={<Button type="button" variant="outline" disabled={pending} className="border-destructive text-destructive hover:text-destructive">Delete…</Button>}
        title="Delete this application?"
        description={
          impact === null ? (
            "Counting values…"
          ) : impact.ok ? (
            <>This permanently deletes <strong>{impact.title}</strong>, its {plural(impact.cellCount, "filled cell value")} and {plural(impact.fileCount, "file")}. This cannot be undone.</>
          ) : (
            <span role="alert" className="text-destructive">{impact.error}</span>
          )
        }
        error={delError}
        confirmLabel="Delete permanently"
        busyLabel="Deleting…"
        confirmDisabled={!impact?.ok}
        busy={pending}
        onConfirm={confirmDelete}
      />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
