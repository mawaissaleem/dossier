"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EllipsisVerticalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { deleteTrack, fetchTrackDeleteImpact, updateTrack } from "@/app/actions/tracks";
import { ColorPicker } from "@/app/color-picker";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useReturnFocus } from "@/components/use-return-focus";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createLatest } from "@/lib/latest";
import { MAX_TRACK_NAME } from "@/lib/track-templates";

type Impact = Awaited<ReturnType<typeof fetchTrackDeleteImpact>>;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// "Track options" on a /tracks tile and the track page header: Rename / colour (a dialog) and Delete track… (a confirm that states the counts and asks for the name).
// An item's action waits until the menu has closed and focus is back on the trigger (as in the column menu), so the dialog returns focus to the trigger.
export function TrackMenu({ id, name, color }: { id: number; name: string; color: string }) {
  const uid = useId();
  const router = useRouter();
  const back = useReturnFocus();
  const trigger = useRef<HTMLButtonElement>(null);
  const next = useRef<(() => void) | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftColor, setDraftColor] = useState(color);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null); // null while loading
  const [typed, setTyped] = useState("");
  const [delError, setDelError] = useState<string | null>(null);
  const [latest] = useState(createLatest); // a late count from an earlier open must not replace the current one
  const [pending, startTransition] = useTransition();

  function openEdit() {
    setDraftName(name);
    setDraftColor(color);
    setError(null);
    back.remember();
    setEditOpen(true);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const r = await updateTrack(id, draftName, draftColor);
        if (r.ok) setEditOpen(false);
        else setError(r.error);
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  // Counted fresh on every open; the delete button stays disabled until the real counts are shown.
  function loadImpact() {
    setImpact(null);
    const token = latest.start();
    fetchTrackDeleteImpact(id).then(
      (r) => latest.current(token) && setImpact(r),
      () => latest.current(token) && setImpact({ ok: false, error: "Could not load the counts. Try again." }),
    );
  }

  function openDelete() {
    setDelError(null);
    setTyped("");
    back.remember();
    setDelOpen(true);
    loadImpact();
  }

  function confirmDelete() {
    if (!impact?.ok) return;
    const { applications, columns, submissions, notes, files } = impact;
    setDelError(null);
    startTransition(async () => {
      try {
        const r = await deleteTrack(id, true, typed, { applications, columns, submissions, notes, files });
        if (r.ok) {
          setDelOpen(false);
          // refresh() after the push, so no cached copy of /tracks or the dashboard (which list tracks) can show the deleted one.
          router.push("/tracks");
          router.refresh();
        } else {
          setDelError(r.error);
          loadImpact(); // the fresh counts, so the next confirm states what is true now
        }
      } catch {
        setDelError("Could not delete. Try again.");
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Track options: ${name}`}
            className="text-muted-foreground"
          >
            <EllipsisVerticalIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-auto min-w-40"
          onCloseAutoFocus={(e) => {
            const fn = next.current;
            next.current = null;
            if (!fn) return; // no item chosen: keep Radix's default
            e.preventDefault();
            trigger.current?.focus();
            fn();
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              next.current = openEdit;
            }}
          >
            <PencilIcon aria-hidden />
            Rename / colour…
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              next.current = openDelete;
            }}
          >
            <Trash2Icon aria-hidden />
            Delete track…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={editOpen}
        onOpenChange={(o) => {
          if (o || !pending) setEditOpen(o);
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md" onCloseAutoFocus={back.onCloseAutoFocus}>
          <form onSubmit={save} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Rename track</DialogTitle>
              <DialogDescription>Applications, columns and files are kept.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-name`}>Name</Label>
              <Input
                id={`${uid}-name`}
                required
                maxLength={MAX_TRACK_NAME}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Colour</span>
              <ColorPicker value={draftColor} onChange={setDraftColor} label="Colour of the track" />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={delOpen}
        onOpenChange={setDelOpen}
        onCloseAutoFocus={back.onCloseAutoFocus}
        title="Delete track?"
        description={
          impact === null ? (
            "Counting…"
          ) : impact.ok ? (
            <>
              This permanently deletes the track <strong className="break-words">{impact.name}</strong> with its{" "}
              {plural(impact.applications, "application")} (archived included), {plural(impact.columns, "column")},{" "}
              {plural(impact.submissions, "submission")}, {plural(impact.notes, "note")} and{" "}
              {plural(impact.files, "file record")}. The files themselves stay on disk; only Dossier forgets them. This
              cannot be undone.
            </>
          ) : (
            <span role="alert" className="text-destructive">
              {impact.error}
            </span>
          )
        }
        error={delError}
        confirmLabel="Delete track"
        busyLabel="Deleting…"
        confirmDisabled={!impact?.ok || typed !== impact.name}
        busy={pending}
        onConfirm={confirmDelete}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-confirm`}>Type the track name to confirm</Label>
          <Input id={`${uid}-confirm`} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
      </ConfirmDialog>
    </>
  );
}
