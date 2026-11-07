"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { updateCell } from "@/app/actions/cells";
import type { OptionItem } from "@/lib/db/columns";
import { ChevronDownIcon } from "lucide-react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { OptionChip } from "@/app/option-chip";
import { findOption } from "@/lib/options";

// NativeSelect (full keyboard support) shown as the chosen option's chip. One updateCell call per change; blank clears.
// useOptimistic shows the new choice while saving and reverts by itself if the save fails (props stay the same).
export function SelectCell({ applicationId, columnId, value, options, label }: {
  applicationId: number; columnId: number; value: string | number | boolean | null | undefined; options: OptionItem[]; label: string;
}) {
  const current = findOption(options, value); // an id that is not in the list shows as blank
  const [shown, setShown] = useOptimistic(current?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Set synchronously: a second change can land before a re-render, so state alone would not block it.
  const locked = useRef(false);

  function choose(value: string) {
    if (locked.current) return; // a change while a save is in flight is ignored (the select goes back to what is shown)
    locked.current = true;
    setError(null);
    startTransition(async () => {
      setShown(value === "" ? null : Number(value));
      try {
        const r = await updateCell(applicationId, columnId, value === "" ? null : Number(value));
        if (!r.ok) setError(r.error);
      } catch {
        setError("Could not save. Try again.");
      } finally {
        locked.current = false;
      }
    });
  }

  if (options.length === 0) return <span role="note" aria-label={`${label}: no options yet`} className="flex h-8 items-center text-muted-foreground">No options yet</span>;
  const chosen = findOption(options, shown);
  return (
    <>
      {/* The chip is what you see; the transparent native select on top is what you click and tab to (full keyboard support, no per-cell Radix). */}
      <div className="group/sel relative flex h-8 min-w-24 items-center rounded-md hover:bg-muted has-[select:focus-visible]:ring-2 has-[select:focus-visible]:ring-ring">
        {chosen && <OptionChip option={chosen} />}
        <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute right-1.5 size-3.5 text-muted-foreground opacity-0 group-hover/sel:opacity-100 group-has-[select:focus-visible]/sel:opacity-100" />
        <NativeSelect
          aria-label={label}
          value={shown === null ? "" : String(shown)}
          onChange={(e) => choose(e.target.value)}
          className="absolute inset-0 w-full [&>select]:h-full [&>select]:cursor-pointer [&>select]:opacity-0 [&>svg]:hidden"
        >
          <NativeSelectOption value="">— (blank)</NativeSelectOption>
          {options.map((o) => (
            <NativeSelectOption key={o.id} value={o.id}>{o.label}</NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {error && <p role="alert" className="mt-1 w-0 min-w-full text-sm text-destructive">{error}</p>}
    </>
  );
}
