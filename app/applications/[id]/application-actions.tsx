"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveApplication, deleteApplication } from "@/app/actions/application-state";

// Archive needs no confirmation (one click undoes it). Delete opens a modal dialog that states what will be lost.
export function ApplicationActions({ id, title, archived, cellCount, fileCount }: {
  id: number; title: string; archived: boolean; cellCount: number; fileCount: number;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
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
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending} className="rounded border px-3 py-1" onClick={() => run(() => archiveApplication(id, !archived))}>
        {archived ? "Unarchive" : "Archive"}
      </button>
      <button type="button" disabled={pending} className="rounded border border-red-600 px-3 py-1 text-red-600" onClick={() => dialog.current?.showModal()}>
        Delete…
      </button>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <dialog ref={dialog} aria-labelledby="delete-title" className="m-auto max-w-md rounded border p-6">
        <h2 id="delete-title" className="mb-2 text-lg font-semibold">Delete this application?</h2>
        <p className="mb-4">
          This permanently deletes <strong>{title}</strong>, its {plural(cellCount, "filled cell value")} and {plural(fileCount, "file")}. This cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button type="button" className="rounded border px-3 py-1" onClick={() => dialog.current?.close()}>Cancel</button>
          <button
            type="button"
            disabled={pending}
            className="rounded bg-red-600 px-3 py-1 text-white"
            onClick={() => { dialog.current?.close(); run(() => deleteApplication(id, true)); }}
          >
            Delete permanently
          </button>
        </div>
      </dialog>
    </div>
  );
}
