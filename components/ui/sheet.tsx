"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// A panel that slides in from the left (the phone navigation): a Radix Dialog, so focus is trapped, Escape closes it
// and focus goes back. Unlike DialogContent a click on the backdrop closes it (it holds no typed input to lose).
// Callers give it a DialogTitle (SheetTitle) for its accessible name.
const Sheet = DialogPrimitive.Root;
const SheetClose = DialogPrimitive.Close;
const SheetTitle = DialogPrimitive.Title;

function SheetContent({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card p-3 text-sm text-card-foreground shadow-lg duration-150 outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left",
          className,
        )}
        {...props}
      />
    </DialogPortal>
  );
}

export { Sheet, SheetClose, SheetContent, SheetTitle };
