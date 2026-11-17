// Pure: the sidebar's cookie, its pre-paint script and the Ctrl/Cmd+B shortcut rules (DASH.4). No DOM, React or DB imports.
export const SIDEBAR_COOKIE = "sidebar";
export type SidebarState = "open" | "closed";

// Anything but "open" (missing, tampered, another cookie that merely ends in "sidebar") is the default: collapsed.
export const parseSidebar = (v: unknown): SidebarState => (v === "open" ? "open" : "closed");

// The state out of a `document.cookie` string ("a=1; sidebar=open; b=2").
export function readSidebar(cookies: string): SidebarState {
  for (const part of cookies.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SIDEBAR_COOKIE) return parseSidebar(value.join("="));
  }
  return "closed";
}

// The `document.cookie` assignment: the whole site, one year, never sent cross-site. Not HttpOnly on purpose: only the page's own script reads it.
export const sidebarCookie = (open: boolean) => `${SIDEBAR_COOKIE}=${open ? "open" : "closed"}; Path=/; Max-Age=31536000; SameSite=Lax`;

// Inline script for <head> (like the theme's): copies the cookie to <html data-sidebar="open"> while the HTML is parsed, before first paint, so the layout stays static and the first paint has the right width.
export const SIDEBAR_INIT_SCRIPT = `(function(){try{if(/(?:^|; )${SIDEBAR_COOKIE}=open(?:;|$)/.test(document.cookie))document.documentElement.setAttribute("data-sidebar","open")}catch(e){}})()`;

// How the shortcut is shown to the user.
export const sidebarChordLabel = (mac: boolean) => (mac ? "⌘B" : "Ctrl+B");

type Keys = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };

// Cmd+B on macOS, Ctrl+B elsewhere; no other modifier.
export const isSidebarChord = (e: Keys, mac: boolean) => e.key.toLowerCase() === "b" && (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey;

// Inputs that take no text, so the chord is fine while one has focus.
const NO_TEXT = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

// Typing = a text field, a select or contenteditable has focus: Ctrl+B belongs to it there.
export function isTypingTarget(t: { tagName?: string; type?: string; isContentEditable?: boolean } | null): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName?.toUpperCase();
  return tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !NO_TEXT.has((t.type ?? "text").toLowerCase()));
}

// Whether a keydown toggles the sidebar: the chord, not held down, not mid-composition, not while typing, not while a dialog or menu is open.
export function toggles(e: Keys & { repeat?: boolean; isComposing?: boolean }, mac: boolean, ctx: { typing: boolean; layerOpen: boolean }): boolean {
  return isSidebarChord(e, mac) && !e.repeat && !e.isComposing && !ctx.typing && !ctx.layerOpen;
}
