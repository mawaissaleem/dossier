"use client";

import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, ExternalLinkIcon, EyeIcon } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useReturnFocus } from "@/components/use-return-focus";
import { positionLabel, stepIndex, type PreviewItem } from "@/lib/preview-nav";

// Preview (FR-5.9). One dialog per list of files (the Files list, or one submission): <PreviewGroup items> wraps the
// list and holds the dialog, each row's <PreviewButton> opens it on its file, and Previous / Next (buttons, Left /
// Right keys) walk the group's previewable files in list order, no wrap. A PDF is the browser's own viewer in an iframe
// on the same GET /api/files/:id route as Open, so the hash check, the changed-file page, the missing-file page and the
// files-folder page behave exactly as in a new tab (they show in the frame). An image is an <img> on the same route: a
// changed or missing one answers with an HTML page, the <img> fails and says so (it never shows unverified bytes). The
// frame or image is keyed by file id: a new one mounts per file, so the iframe does not add session-history entries and
// nothing is reused. Initial focus goes to Close, not the first tabbable (that would be the frame). Focus goes back to
// the button that opened it (useReturnFocus; the dialog has no DialogTrigger because one dialog serves many buttons).
// The actions sit before the frame in tab order, so Tab from Close enters the viewer. A key press inside the frame
// never reaches this page: for the problem pages (same-origin) an Escape / Left / Right listener is attached on each
// load; Firefox's pdf.js is a cross-origin document (the attach throws, caught) and Chrome's viewer is a plugin, so
// from inside a PDF viewer Shift+Tab (back to the actions) or a click outside the frame is needed first. Close always
// works. Below 640 px the dialog is full-screen. A phone browser that cannot show a PDF in a frame still has "Open in
// new tab" and "Download".
const Open = createContext<((id: number) => void) | null>(null);

export function PreviewGroup({ items, children }: { items: PreviewItem[]; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  const back = useReturnFocus();
  const [open, setOpen] = useState(false);
  const [currentId, setCurrentId] = useState(-1); // kept after closing so the exit animation still shows the file
  // -1: the file left the list while open (deleted): the dialog closes
  const index = items.findIndex((i) => i.id === currentId);
  const item = items[index];
  const go = (delta: -1 | 1) => {
    const to = stepIndex(index, items.length, delta);
    if (to !== null) setCurrentId(items[to].id);
  };
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  const arrow = (e: {
    key: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    defaultPrevented: boolean;
    preventDefault(): void;
  }) => {
    if (
      (e.key !== "ArrowLeft" && e.key !== "ArrowRight") ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.defaultPrevented
    )
      return false;
    e.preventDefault();
    goRef.current(e.key === "ArrowLeft" ? -1 : 1);
    return true;
  };
  const src = item ? `/api/files/${item.id}` : "";
  const several = items.length > 1;
  return (
    <Open.Provider
      value={(id) => {
        back.remember();
        setCurrentId(id);
        setOpen(true);
      }}
    >
      {children}
      <Dialog open={open && index >= 0} onOpenChange={setOpen}>
        {item && (
          <DialogContent
            showCloseButton={false}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              close.current?.focus();
            }}
            onCloseAutoFocus={back.onCloseAutoFocus}
            onKeyDown={(e) => {
              if (several) arrow(e);
            }}
            className="h-[calc(100dvh-2rem)] grid-rows-[auto_auto_1fr] sm:max-w-5xl max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0"
          >
            <DialogHeader className="min-w-0">
              <DialogTitle title={item.name} className="truncate leading-normal">
                {item.name}
              </DialogTitle>
              <DialogDescription title={item.storedName} className="truncate">
                {item.storedName}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              {several && (
                <>
                  {/* aria-disabled, not disabled: a disabled button would drop keyboard focus to <body> at the end
                      of the list */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-keyshortcuts="ArrowLeft"
                    aria-disabled={index === 0}
                    className="aria-disabled:opacity-50"
                    onClick={() => go(-1)}
                  >
                    <ChevronLeftIcon aria-hidden /> Previous
                  </Button>
                  <span role="status" className="self-center text-sm text-muted-foreground tabular-nums">
                    {positionLabel(index, items.length)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-keyshortcuts="ArrowRight"
                    aria-disabled={index === items.length - 1}
                    className="aria-disabled:opacity-50"
                    onClick={() => go(1)}
                  >
                    Next <ChevronRightIcon aria-hidden />
                  </Button>
                </>
              )}
              <Button asChild variant="outline" size="sm">
                <a href={src} target="_blank" rel="noopener">
                  Open in new tab <ExternalLinkIcon aria-hidden />
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`${src}?download=1`} target="_blank" rel="noopener">
                  Download <DownloadIcon aria-hidden />
                </a>
              </Button>
              <DialogClose asChild>
                <Button ref={close} type="button" variant="outline" size="sm" className="ml-auto">
                  Close
                </Button>
              </DialogClose>
            </div>
            {item.kind === "image" ? (
              <ImageView key={item.id} src={src} name={item.name} />
            ) : (
              <iframe
                key={item.id}
                src={src}
                title={`Preview of ${item.name}`}
                onLoad={(e) => {
                  // One listener per load, on that load's own window: navigating the frame (Open anyway, Next) replaces
                  // the window, and the old listener goes with it.
                  try {
                    e.currentTarget.contentWindow?.addEventListener("keydown", (k) => {
                      if (k.key === "Escape" && !k.defaultPrevented) setOpen(false);
                      else if (several) arrow(k);
                    });
                  } catch {
                    /* not readable: Close still works */
                  }
                }}
                className="size-full min-h-0 rounded-md border border-border bg-card"
              />
            )}
          </DialogContent>
        )}
      </Dialog>
    </Open.Provider>
  );
}

function ImageView({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex min-h-0 items-center justify-center overflow-auto rounded-md border border-border bg-card p-2">
      {failed ? (
        <p role="alert" className="text-sm text-muted-foreground">
          This image cannot be shown. It may have changed since it was uploaded, or be missing. Open it in a new tab to
          see why.
        </p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a same-origin, hash-checked stored file: next/image would only re-encode it
        <img src={src} alt={name} onError={() => setFailed(true)} className="size-full object-contain" />
      )}
    </div>
  );
}

export function PreviewButton({ id, name }: { id: number; name: string }) {
  const open = useContext(Open);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Preview ${name}`}
      onClick={(e) => {
        e.currentTarget.focus();
        open?.(id);
      }} // focus first: Safari and Firefox on macOS do not focus a clicked button, and the dialog returns focus to it
    >
      Preview <EyeIcon aria-hidden />
    </Button>
  );
}
