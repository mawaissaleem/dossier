"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// A note's date and time in the browser's own zone and language. The server cannot know either, so it renders nothing and the browser
// fills it in (useSyncExternalStore keeps hydration clean); the machine-readable value is always in `dateTime`.
export function NoteTime({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    () => "",
  );
  return <time dateTime={iso} className="tabular-nums">{text}</time>;
}
