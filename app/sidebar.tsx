"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PanelLeftCloseIcon, PanelLeftOpenIcon, XIcon } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useReturnFocus } from "@/components/use-return-focus";
import { isMacPlatform } from "@/lib/search-palette";
import { isTypingTarget, sidebarChordLabel, sidebarCookie, toggles } from "@/lib/sidebar";
import { DossierMark } from "./dossier-mark";
import { NavItems } from "./nav-items";
import { RailTip } from "./rail";
import { useIsMac } from "./search-trigger";

// The sidebar's top and its behaviour (DASH.4). The state lives on <html data-sidebar="open"> (set before first paint from the cookie by SIDEBAR_INIT_SCRIPT) and CSS lays everything out from it (`wide:`,
// globals.css), so the toggle is one attribute and one cookie write; React only mirrors it for aria-expanded. Same source-of-truth idea as the theme (app/theme-switcher.tsx).
const DESKTOP = "(min-width: 48rem)"; // Tailwind `md`: below it the navigation is a top bar and the logo opens the phone panel instead
// The layers an open dialog, alert dialog or menu already own the keyboard in (the search palette's chord leaves them alone the same way). `data-state="open"` only: a closing one lingers in the DOM.
const BUSY_LAYER = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]';

const subscribeAttr = (cb: () => void) => {
  const o = new MutationObserver(cb);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-sidebar"] });
  return () => o.disconnect();
};
const subscribeDesktop = (cb: () => void) => {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const isOpen = () => document.documentElement.dataset.sidebar === "open";

// Expands or collapses, remembers it, and keeps keyboard focus on a visible control: if the change hides the focused nav item (display: none: the toggle itself, or a track link when collapsing),
// focus goes to the toggle that is now shown instead of falling back to <body>.
function setSidebar(open: boolean, logo: HTMLElement | null, collapse: HTMLElement | null) {
  const focused = document.activeElement instanceof HTMLElement && document.activeElement.closest("#main-nav") ? document.activeElement : null;
  if (open) document.documentElement.dataset.sidebar = "open";
  else delete document.documentElement.dataset.sidebar;
  try {
    document.cookie = sidebarCookie(open);
  } catch {
    // Cookies blocked: it still works for this page view.
  }
  if (focused && !focused.checkVisibility()) (open ? collapse : logo)?.focus();
}

const Mark = ({ className }: { className?: string }) => (
  <span aria-hidden className={`grid size-9 shrink-0 place-items-center rounded-lg bg-linear-to-br from-accent to-accent-to text-accent-foreground ${className ?? ""}`}>
    <DossierMark className="size-[18px]" />
  </span>
);

const ICON_BUTTON = "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[18px]";

// `tracks` = the track links (a request-time Suspense hole from the layout), shown in the phone panel as in the expanded sidebar.
export function SidebarHeader({ tracks }: { tracks: React.ReactNode }) {
  const mac = useIsMac();
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP).matches, () => true);
  const open = useSyncExternalStore(subscribeAttr, isOpen, () => false);
  const [sheet, setSheet] = useState(false);
  const logo = useRef<HTMLButtonElement>(null);
  const collapse = useRef<HTMLButtonElement>(null);
  const returnFocus = useReturnFocus(logo);
  const expanded = desktop ? open : sheet;

  useEffect(() => {
    let dismissed: Element | null = null; // the item whose tooltip Escape closed
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const tipped = document.querySelector(".group\\/rail:hover, .group\\/rail:focus-visible");
        if (tipped) { dismissed = tipped; document.documentElement.setAttribute("data-tips-off", ""); }
        return;
      }
      if (!window.matchMedia(DESKTOP).matches) return;
      if (!toggles(e, isMacPlatform(navigator.platform), { typing: isTypingTarget(e.target as HTMLInputElement | null), layerOpen: !!document.querySelector(BUSY_LAYER) })) return;
      e.preventDefault(); // the browser's own Ctrl+B (bookmarks, bold) stays out of it
      setSidebar(!isOpen(), logo.current, collapse.current);
    };
    // Tooltips come back when the pointer or focus reaches a different item.
    const restore = (e: Event) => {
      if (dismissed && !dismissed.contains(e.target as Node)) { document.documentElement.removeAttribute("data-tips-off"); dismissed = null; }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerover", restore);
    document.addEventListener("focusin", restore);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerover", restore); document.removeEventListener("focusin", restore); };
  }, []);

  // Browser back/forward (the phone's back gesture) navigates behind the open panel without a click inside it: close it then too (focus goes back to the logo via onCloseAutoFocus).
  useEffect(() => {
    if (!sheet) return;
    const close = () => setSheet(false);
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, [sheet]);

  function onLogo() {
    if (window.matchMedia(DESKTOP).matches) setSidebar(true, logo.current, collapse.current);
    else { returnFocus.remember(); setSheet(true); }
  }

  return (
    <div className="flex shrink-0 items-center max-md:mr-1 md:mb-2 wide:w-full wide:justify-between wide:px-1">
      {/* The logo mark is the way in: a real button (hidden while the desktop sidebar is expanded, where the collapse button takes over). On hover or focus the logo becomes the sidebar icon. */}
      <button
        ref={logo}
        type="button"
        aria-expanded={expanded}
        aria-controls={desktop ? "main-nav" : sheet ? "phone-nav" : undefined}
        aria-label={expanded ? "Close sidebar" : "Open sidebar"}
        onClick={onLogo}
        className="group/rail relative grid size-11 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring wide:hidden"
      >
        <Mark className="md:group-hover/rail:hidden md:group-focus-visible/rail:hidden" />
        <span aria-hidden className="hidden size-9 place-items-center rounded-lg bg-muted text-foreground md:group-hover/rail:grid md:group-focus-visible/rail:grid">
          <PanelLeftOpenIcon className="size-[18px]" />
        </span>
        <RailTip>{`Open sidebar · ${sidebarChordLabel(mac)}`}</RailTip>
      </button>
      <span className="hidden items-center gap-2.5 wide:flex">
        <Mark />
        <span className="text-lg font-semibold tracking-tight">Dossier</span>
      </span>
      <button ref={collapse} type="button" aria-expanded aria-controls="main-nav" aria-label="Close sidebar" onClick={() => setSidebar(false, logo.current, collapse.current)} className={`${ICON_BUTTON} hidden wide:grid`}>
        <PanelLeftCloseIcon aria-hidden />
      </button>

      {/* Phone: the same navigation as a panel from the left. Backdrop, Escape and any link inside close it; focus is trapped while it is open and goes back to the logo. */}
      <Sheet open={sheet && !desktop} onOpenChange={setSheet}>
        <SheetContent
          data-wide
          id="phone-nav"
          aria-describedby={undefined}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          onClick={(e) => { if ((e.target as HTMLElement).closest("a[href]")) setSheet(false); }}
        >
          <div className="mb-3.5 flex items-center justify-between px-1">
            <span className="flex items-center gap-2.5">
              <Mark />
              <SheetTitle className="text-lg font-semibold tracking-tight">Dossier</SheetTitle>
            </span>
            <SheetClose className={ICON_BUTTON} aria-label="Close sidebar"><XIcon aria-hidden /></SheetClose>
          </div>
          <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-1">
            <NavItems tracks={tracks} onSearch={() => setSheet(false)} />
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}
