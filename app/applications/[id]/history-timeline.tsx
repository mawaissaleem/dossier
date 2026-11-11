"use client";

import { ArrowRightLeftIcon, CircleDotIcon, FileXIcon, SendIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { HistoryItem, HistoryType } from "@/lib/history";
import { NoteItem } from "./note-item";
import { NoteTime } from "./note-time";

const SHOWN = 20; // the latest items shown before "Show all"; a long history stays short to scroll
const ICON = { status: ArrowRightLeftIcon, upload: UploadIcon, delete: FileXIcon, submission: SendIcon, other: CircleDotIcon } satisfies Record<Exclude<HistoryType, "note">, unknown>;

// The merged history, newest first (lib/history.ts). Notes are cards; log events are lighter: icon, one line, time.
export function HistoryTimeline({ items }: { items: HistoryItem[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <>
      <ol aria-label="History" className="mt-3 flex flex-col gap-2">
        {shown.map((i) => {
          if (i.type === "note") return <NoteItem key={i.key} body={i.text} at={i.at} />;
          const Icon = ICON[i.type];
          return (
            <li key={i.key} className="flex items-start gap-2 px-3 py-1 text-sm text-muted-foreground">
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1 break-words text-foreground">{i.text}</span>
              {i.future && <span className="shrink-0 rounded-sm bg-muted px-1.5 text-xs leading-5 font-medium text-foreground">Scheduled</span>}
              <span className="shrink-0 text-xs leading-5"><NoteTime iso={i.at.toISOString()} dateOnly={i.type === "submission"} /></span>
            </li>
          );
        })}
      </ol>
      {!all && items.length > SHOWN && (
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setAll(true)}>Show all {items.length} items</Button>
      )}
    </>
  );
}
