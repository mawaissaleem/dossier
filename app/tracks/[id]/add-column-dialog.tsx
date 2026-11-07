"use client";

import { useId, useState, useTransition } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { columnTypeOptions } from "@/lib/column-types";
import type { ColumnType } from "@/lib/db/schema";

export type AddColumnResult = { ok: true } | { ok: false; error: string }; // the action's result (with an id) fits

// Radix Dialog (components/ui/dialog): focus goes to the Name field, Escape closes, focus returns to the "+" trigger.
export function AddColumnDialog({ onSubmit }: { onSubmit: (name: string, type: ColumnType) => Promise<AddColumnResult> }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ColumnType>(columnTypeOptions[0].type);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset on every close (Escape, Cancel, success) so reopening starts clean; a failed submit keeps the dialog open and the input.
  function change(next: boolean) {
    if (!next && pending) return; // Escape and Cancel are ignored while saving (as in 1.6), so a late result can never land on a closed or reopened dialog
    setOpen(next);
    if (!next) {
      setName("");
      setType(columnTypeOptions[0].type);
      setError(null);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const r = await onSubmit(name, type);
        if (r.ok) {
          setOpen(false);
          setName("");
          setType(columnTypeOptions[0].type);
          setError(null);
        } else setError(r.error);
      } catch {
        setError("Could not save. Try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Add column" className="text-muted-foreground">
          <PlusIcon aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add column</DialogTitle>
            <DialogDescription>The type cannot be changed later. To use a different type, add a new column.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-name`}>Name</Label>
            <Input id={`${uid}-name`} required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-type`}>Type</Label>
            <NativeSelect id={`${uid}-type`} value={type} onChange={(e) => setType(e.target.value as ColumnType)} className="w-full">
              {columnTypeOptions.map((o) => (
                <NativeSelectOption key={o.type} value={o.type}>{o.label}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => change(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add column"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
