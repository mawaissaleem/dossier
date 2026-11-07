"use client";

import { useRef } from "react";

// Radix only returns focus to a <DialogTrigger>. A dialog opened from state (a menu item, a row button) calls `remember()` as it opens
// and passes `onCloseAutoFocus` to its DialogContent / ConfirmDialog, so closing puts focus back on what had it.
export function useReturnFocus() {
  const el = useRef<HTMLElement | null>(null);
  return {
    remember: () => { el.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; },
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault();
      el.current?.focus();
    },
  };
}
