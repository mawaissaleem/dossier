"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveFilesRoot } from "@/app/actions/settings";

export function FilesRootForm({ current }: { current: string | null }) {
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const r = await saveFilesRoot(value);
        if (r.ok) {
          setValue(r.path);
          setSaved(true);
        } else {
          setError(r.error);
        }
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
      <Label htmlFor="files-root">Files root folder</Label>
      <div className="flex gap-2">
        <Input
          id="files-root"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          placeholder="/home/you/Dossier"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "files-root-err" : undefined}
        />
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      </div>
      {error && <p id="files-root-err" role="alert" className="text-sm text-destructive">{error}</p>}
      {saved && <p role="status" className="text-sm text-muted-foreground">Saved.</p>}
    </form>
  );
}
