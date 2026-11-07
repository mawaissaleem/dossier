"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { archiveApplication, deleteApplication } from "@/app/actions/application-state";

// Archive needs no confirmation (one click undoes it), so it is a neutral outline button. Delete opens a confirm that states what will be lost.
export function ApplicationActions({ id, title, archived, cellCount, fileCount }: {
  id: number; title: string; archived: boolean; cellCount: number; fileCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  function run(fn: () => Promise<{ ok: true; trackId?: number } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const r = await fn();
        if (!r.ok) setError(r.error);
        else if (r.trackId !== undefined) router.push(`/tracks/${r.trackId}`);
      } catch {
        setError("Could not complete. Try again.");
      }
    });
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
      <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => archiveApplication(id, !archived))}>
        {archived ? "Unarchive" : "Archive"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        trigger={<Button type="button" variant="outline" disabled={pending} className="border-destructive text-destructive hover:text-destructive">Delete…</Button>}
        title="Delete this application?"
        description={<>This permanently deletes <strong>{title}</strong>, its {plural(cellCount, "filled cell value")} and {plural(fileCount, "file")}. This cannot be undone.</>}
        confirmLabel="Delete permanently"
        busyLabel="Deleting…"
        busy={pending}
        onConfirm={() => { setOpen(false); run(() => deleteApplication(id, true)); }}
      />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
