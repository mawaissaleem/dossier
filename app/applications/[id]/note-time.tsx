"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// A date and time in the browser's own zone and language. The server cannot know either, so it renders the same moment in English and
// UTC (labelled, so it is readable without JS) and the browser replaces it after hydration; the machine-readable value is always in
// `dateTime`. `dateOnly` drops the time (a submission is dated by day; a backdated one has no real time of day).
export function NoteTime({ iso, dateOnly }: { iso: string; dateOnly?: boolean }) {
  const opts: Intl.DateTimeFormatOptions = dateOnly ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" };
  const text = useSyncExternalStore(
    subscribe,
    () => new Date(iso).toLocaleString(undefined, opts),
    () => new Date(iso).toLocaleString("en-GB", { ...opts, timeZone: "UTC" }) + (dateOnly ? "" : " UTC"),
  );
  return <time dateTime={iso} className="tabular-nums">{text}</time>;
}
