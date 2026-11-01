"use client";

import { useState, useTransition } from "react";
import { createApplication } from "@/app/actions/applications";

export function NewApplicationForm({ trackId }: { trackId: number }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createApplication(title, trackId);
      if (r.ok) {
        setTitle("");
        setError(null);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="mb-4 flex flex-wrap items-center gap-2">
      <label htmlFor="new-title" className="text-sm">Title</label>
      <input
        id="new-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="rounded border border-foreground/30 px-2 py-1"
      />
      <button type="submit" disabled={pending} className="rounded bg-foreground px-3 py-1 text-background disabled:opacity-50">
        {pending ? "Saving…" : "Save"}
      </button>
      {error && <p role="alert" className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
