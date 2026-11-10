"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useReturnFocus } from "@/components/use-return-focus";
import { cn } from "@/lib/utils";
import { chordLabel, highlightSegments, isMacPlatform, isSearchChord, wrapIndex } from "@/lib/search-palette";

// Shape of GET /api/search (task 4.6).
type Hit = { id: number; title: string; archived: boolean; track: { id: number; name: string }; matched: { kind: "title" | "cell" | "note"; column: string | null; snippet: string } };
// The newest answer: for `query`, either hits or an error. Anything for another query is stale.
type Answer = { query: string; hits: Hit[]; error?: string };

const DEBOUNCE_MS = 150;
// An open dialog, alert dialog or menu already has the user's attention; the chord leaves it alone.
// Only data-state="open" counts: a Radix layer (the palette's own included) stays in the DOM as "closed" during its exit animation.
const BUSY_LAYER = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]';

// Text with the matching words marked. Segments are React text children, never HTML.
function Highlight({ text, query }: { text: string; query: string }) {
  return highlightSegments(text, query).map((s, i) =>
    s.match ? <mark key={i} className="bg-transparent font-semibold text-foreground underline decoration-accent decoration-2 underline-offset-2">{s.text}</mark> : s.text,
  );
}

// The search button (side nav / top bar) plus the Ctrl/Cmd+K palette. Mounted once, in the app frame.
export function SearchPalette({ className }: { className?: string }) {
  const router = useRouter();
  const id = useId();
  const mac = useSyncExternalStore(() => () => {}, () => isMacPlatform(navigator.platform), () => false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const returnFocus = useReturnFocus(button);
  const navigated = useRef(false);
  const openWhenReady = useRef(false); // Enter pressed before the answer for this query arrived
  const q = query.trim();

  function openPalette() {
    // Reopened during its own close animation: focus is still in the old input, and the target remembered last time still holds.
    if (!content.current?.contains(document.activeElement)) returnFocus.remember();
    navigated.current = false;
    openWhenReady.current = false;
    setQuery("");
    setAnswer(null);
    setActive(0);
    setOpen(true);
  }

  function go(hit: Hit) {
    navigated.current = true; // the new page owns focus now
    setOpen(false);
    router.push(`/applications/${hit.id}`);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || !isSearchChord(e, mac)) return;
      e.preventDefault(); // keep the browser's own Ctrl+K (address bar / search) out of it
      if (!open && !document.querySelector(BUSY_LAYER)) openPalette();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openPalette only uses setters and refs
  }, [open, mac]);

  // Debounced fetch. The cleanup aborts the old request, so only the latest query can ever answer.
  useEffect(() => {
    if (!open || !q) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      let next: Answer;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const body = await res.json().catch(() => null);
        if (!res.ok) next = { query: q, hits: [], error: typeof body?.error === "string" ? body.error : `Search failed (${res.status}).` };
        else if (!Array.isArray(body?.results)) next = { query: q, hits: [], error: "Search returned something unexpected." };
        else next = { query: q, hits: body.results };
      } catch {
        if (ctrl.signal.aborted) return;
        next = { query: q, hits: [], error: "Could not reach the app. Check that it is still running." };
      }
      if (ctrl.signal.aborted) return;
      setAnswer(next);
      setActive(0);
      const first = next.hits[0];
      if (openWhenReady.current && first) go(first);
      openWhenReady.current = false;
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go only uses setters, a ref and the router
  }, [open, q]);

  const fresh = answer?.query === q;
  const loading = !!q && !fresh;
  const error = fresh ? answer.error : undefined;
  const hits = answer?.hits ?? []; // while loading these are the previous query's: shown dimmed, never opened by Enter
  const showList = !!q && !error && hits.length > 0;
  const optionId = (i: number) => `${id}-opt-${i}`;

  useEffect(() => {
    if (showList) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionId is derived from id
  }, [active, showList]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (showList) setActive(wrapIndex(active, e.key === "ArrowDown" ? 1 : -1, hits.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (loading) openWhenReady.current = !!q; // opens the first hit as soon as this query answers
      else if (showList) go(hits[active]);
    }
  }

  return (
    <>
      <Button ref={button} variant="outline" className={cn("justify-start gap-2 text-muted-foreground", className)} aria-keyshortcuts={mac ? "Meta+K" : "Control+K"} onClick={openPalette}>
        <SearchIcon aria-hidden />
        Search
        <kbd className="ml-auto rounded-sm border border-border px-1.5 text-xs font-medium">{chordLabel(mac)}</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          ref={content}
          showCloseButton={false}
          className="top-[15%] translate-y-0 gap-2 p-2 sm:max-w-xl"
          onCloseAutoFocus={(e) => (navigated.current ? e.preventDefault() : returnFocus.onCloseAutoFocus(e))}
        >
          <DialogTitle className="sr-only">Search applications</DialogTitle>
          <DialogDescription className="sr-only">Type to search titles, text fields and notes. Arrow keys choose a result, Enter opens it, Escape closes.</DialogDescription>
          <Input
            role="combobox"
            aria-label="Search applications"
            aria-expanded={showList}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={showList ? optionId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            placeholder="Search by company, title, text field or note"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); openWhenReady.current = false; }}
            onKeyDown={onKeyDown}
          />
          {showList && (
            <ul id={`${id}-list`} role="listbox" aria-label="Results" aria-busy={loading} className={cn("max-h-80 overflow-y-auto", loading && "opacity-60")}>
              {hits.map((h, i) => (
                <li
                  key={h.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => go(h)}
                  className="relative flex cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2 aria-selected:bg-muted aria-selected:before:absolute aria-selected:before:inset-y-2 aria-selected:before:left-0 aria-selected:before:w-0.75 aria-selected:before:rounded-full aria-selected:before:bg-linear-to-b aria-selected:before:from-accent aria-selected:before:to-accent-to"
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground"><Highlight text={h.title} query={q} /></span>
                    {h.archived && <span className="inline-flex h-5 shrink-0 items-center rounded-sm border border-border bg-muted px-2 text-xs font-medium text-muted-foreground">Archived</span>}
                    <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{h.track.name}</span>
                  </span>
                  {h.matched.kind !== "title" && (
                    <span className="truncate text-xs text-muted-foreground">{h.matched.kind === "note" ? "Note" : h.matched.column}: <Highlight text={h.matched.snippet} query={q} /></span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/* One status line, announced politely; the listbox above carries the results themselves. */}
          <p role={error ? "alert" : "status"} className={cn("px-3 py-2 text-sm", error ? "text-destructive" : "text-muted-foreground", showList && "sr-only")}>
            {error ?? (!q ? "Type to search." : loading ? "Searching…" : hits.length === 0 ? "No matches." : `${hits.length} ${hits.length === 1 ? "result" : "results"}.`)}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
