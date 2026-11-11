"use client";

import { ChevronRightIcon, DownloadIcon, ExternalLinkIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SubmissionItem } from "@/lib/db/submissions";
import { IntegrityBadge } from "./integrity-badge";
import { SubmissionNote } from "./submission-note";
import { fileCountLabel } from "@/lib/submission-timeline";
import { cn } from "@/lib/utils";

// Submissions, newest first (FR-7.9). The latest starts expanded; the page keys this component by the latest id, so a new submission
// remounts it expanded. Open is the 5.10 route in a new tab. Download is the same route with the `download` attribute: the server's safe
// headers (nosniff, CSP, sanitised filename) are unchanged, and the attribute only makes the browser save instead of render.
// A file flagged changed or missing (8.7) gets a Download link without the attribute, in a new tab: the 409 mismatch page (or the 404 error) is
// shown instead of being saved as the file. A file edited since its last check still gets `download`; the browser then shows a failed download.
export function SubmissionTimeline({ items }: { items: SubmissionItem[] }) {
  const uid = useId();
  const [open, setOpen] = useState<Set<number>>(() => new Set(items.length ? [items[0].id] : []));
  const toggle = (id: number) => setOpen((o) => { const n = new Set(o); if (!n.delete(id)) n.add(id); return n; });
  return (
    <ol aria-label="Submissions" className="ml-1.5 border-l border-input">
      {items.map((s, i) => {
        const isOpen = open.has(s.id);
        const panel = `${uid}-${s.id}`;
        return (
          <li key={s.id} className="relative pb-3 pl-5 last:pb-0">
            <span aria-hidden className={cn("absolute top-3.5 -left-[5px] size-2.5 rounded-full", i === 0 ? "bg-accent" : "bg-muted-foreground")} />
            <div className="rounded-lg border border-border bg-card">
              <h3 className="text-sm">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panel}
                  onClick={() => toggle(s.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronRightIcon aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                  <time dateTime={s.date} className="font-semibold tabular-nums">{s.date}</time>
                  <span className="text-muted-foreground">{fileCountLabel(s.files.length)}</span>
                  {i === 0 && <span className="ml-auto rounded-sm bg-muted px-1.5 text-xs leading-5 font-medium">Latest</span>}
                </button>
              </h3>
              <SubmissionNote id={s.id} date={s.date} note={s.note} />
              <div id={panel} hidden={!isOpen}>
                {s.files.length === 0 ? (
                  <p className="border-t border-border px-3 py-2 pl-9 text-sm text-muted-foreground">No files were recorded for this submission.</p>
                ) : (
                  <ul className="divide-y divide-border border-t border-border">
                    {s.files.map((f) => (
                      <li key={f.id} className="flex items-center gap-3 px-3 py-2 pl-9">
                        <div className="min-w-0 flex-1">
                          <p className="flex min-w-0 flex-wrap items-center gap-x-2">
                            <span title={f.originalName} className="truncate font-medium">{f.originalName}</span>
                            <span title={f.label} className="max-w-32 shrink-0 truncate rounded-sm bg-muted px-1.5 text-xs leading-5 font-medium">{f.label}</span>
                            <IntegrityBadge state={f.integrity} checkedAt={f.checkedAt} />
                          </p>
                        </div>
                        <Button asChild variant="outline" size="sm">
                          <a href={`/api/files/${f.id}`} target="_blank" rel="noopener" aria-label={`Open ${f.originalName}`}>
                            Open <ExternalLinkIcon aria-hidden />
                          </a>
                        </Button>
                        <Button asChild variant="ghost" size="sm">
                          {/* A flagged file: no `download`, so the 409 "file changed" page opens (with "Open anyway") instead of being saved as the file. */}
                          <a href={`/api/files/${f.id}`} {...(f.integrity === "ok" ? { download: true } : { target: "_blank", rel: "noopener" })} aria-label={`Download ${f.originalName}`}>
                            Download <DownloadIcon aria-hidden />
                          </a>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
