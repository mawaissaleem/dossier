"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TriangleAlertIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { todayLocal } from "@/lib/filename";
import { chooseLabel, CUSTOM_LABEL, describeResponse, duplicateMessage, formatBytes, sizeError, type UploadOutcome } from "@/lib/upload-client";
import { cn } from "@/lib/utils";

const settingsLink = <Link href="/settings" className="rounded-sm text-accent underline outline-none focus-visible:ring-2 focus-visible:ring-ring">Settings</Link>;
const noop = () => () => {};

// Upload files to the 5.7 route with fetch + FormData (a server action would cap the body at 1 MB). One label and one date apply to the whole batch.
// A new selection replaces the old one. The date shows the browser's local today until edited (blank sends today too).
export function FileUpload({ applicationId, labels, rootSet }: { applicationId: number; labels: string[]; rootSet: boolean }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [choice, setChoice] = useState(labels[0] ?? CUSTOM_LABEL);
  const [custom, setCustom] = useState("");
  const [date, setDate] = useState<string | null>(null); // null = untouched, follows today
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const today = useSyncExternalStore(noop, todayLocal, () => ""); // "" on the server and during hydration, so no mismatch

  if (!rootSet) {
    return (
      <p className="rounded-lg border border-border bg-card p-3 text-sm">
        Choose a files folder in {settingsLink} before uploading. Uploaded files are copied into it.
      </p>
    );
  }

  function select(list: FileList | null) {
    if (pending || !list || list.length === 0) return;
    const chosen = [...list];
    setOutcome(null);
    setClientError(sizeError(chosen.map((f) => f.size)));
    setFiles(chosen);
    if (picker.current) picker.current.value = ""; // so choosing the same file again still fires change
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setOutcome(null);
    const tooBig = sizeError(files.map((f) => f.size));
    if (tooBig) return setClientError(tooBig);
    setClientError(null);
    const form = new FormData();
    for (const f of files) form.append("files", f);
    form.set("label", chooseLabel(choice, custom));
    form.set("uploadDate", date || today);
    setPending(true);
    let result: UploadOutcome;
    try {
      const res = await fetch(`/api/applications/${applicationId}/files`, { method: "POST", body: form });
      result = describeResponse(res.status, await res.json().catch(() => undefined));
    } catch {
      result = { ok: false, stored: [], duplicates: [], message: "Could not reach the app. Check that it is still running and try again.", fieldErrors: {}, settingsLink: false };
    }
    setPending(false);
    picker.current?.focus(); // the submit button was disabled meanwhile, so focus would be lost
    setOutcome(result);
    if (result.ok) setFiles([]);
    if (result.stored.length) router.refresh();
  }

  const fe = outcome?.fieldErrors ?? {};
  const filesError = clientError ?? fe.files;
  const customShown = choice === CUSTOM_LABEL;
  const fieldError = (id: string, msg?: string) => msg && <p id={id} role="alert" className="text-sm text-destructive">{msg}</p>;

  return (
    <form aria-label="Upload files" onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="upload-files"
          onClick={(e) => { if (pending) e.preventDefault(); }}
          onDragOver={(e) => { e.preventDefault(); if (!pending) setDragging(true); }} // always, or a file dropped mid-upload navigates away
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); select(e.dataTransfer.files); }}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed border-input px-4 py-6 text-center text-sm transition-colors hover:bg-muted has-[:focus-visible]:border-ring has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
            dragging && "border-ring bg-muted",
            pending && "cursor-not-allowed opacity-50",
            filesError && "border-destructive",
          )}
        >
          <UploadIcon aria-hidden className="size-5 text-muted-foreground" />
          <span className="font-medium">Choose files or drop them here</span>
          <span id="upload-hint" className="text-muted-foreground">Any file type, up to 50 MB in total. Your originals are copied, never changed.</span>
          <input
            ref={picker}
            id="upload-files"
            type="file"
            multiple
            onChange={(e) => select(e.target.files)}
            aria-describedby={cn("upload-hint", filesError && "upload-files-err")}
            aria-invalid={filesError ? true : undefined}
            className="sr-only"
          />
        </label>
        {fieldError("upload-files-err", filesError ?? undefined)}
        {files.length > 0 && (
          <ul aria-label="Selected files" className="mt-1 divide-y divide-border rounded-md border border-border text-sm">
            {files.map((f, i) => (
              <li key={i} className="flex justify-between gap-3 px-2 py-1">
                <span className="min-w-0 break-all">{f.name}</span>
                <span className="shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="upload-label" className="text-muted-foreground">Label (applies to every file chosen)</Label>
          <NativeSelect
            id="upload-label"
            value={choice}
            disabled={pending}
            onChange={(e) => setChoice(e.target.value)}
            className="w-full"
            aria-invalid={fe.label && !customShown ? true : undefined}
            aria-describedby={fe.label && !customShown ? "upload-label-err" : undefined}
          >
            {[...new Set(labels)].map((l) => <NativeSelectOption key={l} value={l}>{l}</NativeSelectOption>)}
            <NativeSelectOption value={CUSTOM_LABEL}>Custom…</NativeSelectOption>
          </NativeSelect>
          {customShown && (
            <Input
              aria-label="Custom label"
              value={custom}
              disabled={pending}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="For example Portfolio"
              autoComplete="off"
              autoFocus
              aria-invalid={fe.label ? true : undefined}
              aria-describedby={fe.label ? "upload-label-err" : undefined}
            />
          )}
          {fieldError("upload-label-err", fe.label)}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="upload-date" className="text-muted-foreground">Upload date</Label>
          <Input
            id="upload-date"
            type="date"
            value={date ?? today}
            disabled={pending}
            onChange={(e) => setDate(e.target.value)}
            aria-invalid={fe.uploadDate ? true : undefined}
            aria-describedby={fe.uploadDate ? "upload-date-err" : undefined}
          />
          {fieldError("upload-date-err", fe.uploadDate)}
        </div>
      </div>

      {outcome?.message && (
        <p role="alert" className="text-sm text-destructive">
          {outcome.message}
          {outcome.settingsLink && <> Open {settingsLink} to fix it.</>}
        </p>
      )}
      {outcome && outcome.stored.length > 0 && <p role="status" className="text-sm break-words">Stored {outcome.stored.join(", ")}</p>}
      {outcome && outcome.duplicates.length > 0 && (
        <div role="status" className="flex gap-2 rounded-md border border-warning bg-muted p-3 text-sm">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <ul className="min-w-0 break-words">
            {outcome.duplicates.map((d, i) => <li key={i}>{duplicateMessage(d)}</li>)}
          </ul>
        </div>
      )}

      <div>
        <Button type="submit" disabled={pending || files.length === 0 || !!clientError}>
          {pending ? "Uploading…" : files.length > 1 ? `Upload ${files.length} files` : "Upload"}
        </Button>
      </div>
    </form>
  );
}
