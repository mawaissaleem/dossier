"use client";

import { useId, useRef, useState, useTransition } from "react";
import { XIcon } from "lucide-react";
import { saveExpectedLabels } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkExpectedLabels } from "@/lib/expected-labels";

export function ExpectedLabelsForm({ trackId, trackName, initial, suggestions }: { trackId: number; trackName: string; initial: string[]; suggestions: string[] }) {
  const [labels, setLabels] = useState(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  function change(next: string[]) {
    setLabels(next);
    setSaved(false);
    setError(null);
  }

  function add() {
    if (draft.trim() === "") return;
    const r = checkExpectedLabels([...labels, draft]); // same rules as the server, so the message appears before a round trip
    if ("error" in r) return setError(r.error);
    change(r.labels);
    setDraft("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const r = await saveExpectedLabels(trackId, labels);
        if (r.ok) setSaved(true);
        else setError(r.error);
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-card p-3">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{trackName}</legend>
        {labels.length === 0 ? (
          <p className="mb-2 text-sm text-muted-foreground">None: {trackName} applications are never warned about a missing label.</p>
        ) : (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {labels.map((l) => (
              <li key={l} className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-muted pl-2.5 pr-1 text-xs font-medium">
                {l}
                <button
                  type="button"
                  aria-label={`Remove ${l}`}
                  onClick={() => { change(labels.filter((x) => x !== l)); input.current?.focus(); }}
                  className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <XIcon className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex max-w-sm gap-2">
          <Input
            ref={input}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            list={`${id}-suggestions`}
            aria-label={`Add expected label for ${trackName}`}
            placeholder="Add a label"
            aria-invalid={error ? true : undefined}
          />
          <Button type="button" variant="outline" onClick={add}>Add</Button>
        </div>
        <datalist id={`${id}-suggestions`}>
          {suggestions.filter((s) => !labels.some((l) => l.toLowerCase() === s.toLowerCase())).map((s) => <option key={s} value={s} />)}
        </datalist>
      </fieldset>
      <div className="mt-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {saved && <p role="status" className="text-sm text-muted-foreground">Saved.</p>}
      </div>
    </form>
  );
}
