"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

// The shared confirm step (DESIGN.md "Dialogs and menus"). The description says what will be lost; Cancel takes the initial focus;
// `busy` locks Escape and Cancel so a late result never lands on a closed dialog. Pass `trigger` (a Button) to open it from a button
// (Radix returns focus to it); without one, the opener sets `open` and Radix returns focus to whatever had it.
export function ConfirmDialog({ open, onOpenChange, trigger, title, description, children, error, confirmLabel, busyLabel, confirmDisabled, busy, onConfirm, onCloseAutoFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: React.ReactNode;
  title: string;
  description: React.ReactNode; // inline content only (it sits in a <p>)
  children?: React.ReactNode;
  error?: string | null;
  confirmLabel: string;
  busyLabel: string;
  confirmDisabled?: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          cancel.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-foreground">{description}</DialogDescription>
        </DialogHeader>
        {children}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button ref={cancel} type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={busy || confirmDisabled} onClick={onConfirm}>{busy ? busyLabel : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
