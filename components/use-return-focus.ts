"use client";

import { useRef, type RefObject } from "react";

// A dialog or menu in its exit animation: still in the DOM (and still holding focus) for ~150 ms, about to unmount.
const CLOSING_LAYER = ':is([role="dialog"], [role="alertdialog"], [role="menu"])[data-state="closed"]';

// Radix only returns focus to a <DialogTrigger>. A dialog opened from state (a menu item, a row button) calls `remember()` as it opens
// and passes `onCloseAutoFocus` to its DialogContent / ConfirmDialog, so closing puts focus back on what had it.
// `fallback` gets focus when there is nothing usable to go back to.
export function useReturnFocus(fallback?: RefObject<HTMLElement | null>) {
  const el = useRef<HTMLElement | null>(null);
  return {
    remember: () => {
      const a = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // Nothing focused (body: the control was disabled while saving) or inside that layer (its controls are about to unmount): use `fallback` instead.
      el.current = a === document.body || a?.closest(CLOSING_LAYER) ? null : a;
    },
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault();
      (el.current?.isConnected ? el.current : fallback?.current)?.focus();
    },
  };
}
