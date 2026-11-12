"use client";

import { useState } from "react";

// useState(initial) that follows `initial` when the server sends a different value (after a reset to defaults refreshes the page).
// `initial` is compared by `key` (default: its JSON, since props arrive as fresh objects on every refresh), so an unchanged form keeps what is being typed.
export function useSyncedState<T>(initial: T, key: string = JSON.stringify(initial)) {
  const [seen, setSeen] = useState(key);
  const [value, setValue] = useState(initial);
  if (key !== seen) { // set during render: React re-renders at once with the new value (the documented "adjust state on prop change" pattern)
    setSeen(key);
    setValue(initial);
  }
  return [value, setValue] as const;
}
