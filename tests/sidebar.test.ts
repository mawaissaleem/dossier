import { describe, expect, it } from "vitest";
import { SIDEBAR_INIT_SCRIPT, isSidebarChord, isTypingTarget, parseSidebar, readSidebar, sidebarChordLabel, sidebarCookie, toggles } from "@/lib/sidebar";

describe("sidebar cookie (pure)", () => {
  it("parses open and treats everything else as collapsed", () => {
    expect(parseSidebar("open")).toBe("open");
    for (const v of ["closed", "", "OPEN", "1", null, undefined, 1]) expect(parseSidebar(v)).toBe("closed");
  });

  it("reads it from a document.cookie string, only by its exact name", () => {
    expect(readSidebar("sidebar=open")).toBe("open");
    expect(readSidebar("a=1; sidebar=open; b=2")).toBe("open");
    expect(readSidebar("a=1; sidebar=closed")).toBe("closed");
    expect(readSidebar("")).toBe("closed");
    expect(readSidebar("mysidebar=open; sidebar2=open")).toBe("closed");
  });

  it("serialises for the whole site, a year, SameSite=Lax; the value round-trips", () => {
    expect(sidebarCookie(true)).toBe("sidebar=open; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(sidebarCookie(false)).toBe("sidebar=closed; Path=/; Max-Age=31536000; SameSite=Lax");
    for (const open of [true, false]) expect(readSidebar(sidebarCookie(open).split(";")[0])).toBe(open ? "open" : "closed");
  });

  it("the pre-paint script sets data-sidebar exactly when readSidebar says open", () => {
    for (const cookie of ["", "sidebar=open", "sidebar=closed", "a=1; sidebar=open; b=2", "x=1; sidebar=open", "mysidebar=open", "sidebar=opened", "sidebar=open=x"]) {
      const set: [string, string][] = [];
      new Function("document", SIDEBAR_INIT_SCRIPT)({ cookie, documentElement: { setAttribute: (k: string, v: string) => set.push([k, v]) } });
      expect(set, cookie).toEqual(readSidebar(cookie) === "open" ? [["data-sidebar", "open"]] : []);
    }
  });

  it("the pre-paint script never throws when cookies are unavailable", () => {
    expect(() => new Function("document", SIDEBAR_INIT_SCRIPT)({ get cookie() { throw new Error("blocked"); } })).not.toThrow();
  });
});

describe("sidebar shortcut (pure)", () => {
  const key = (o: Partial<Parameters<typeof isSidebarChord>[0]> = {}) => ({ key: "b", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...o });
  const free = { typing: false, layerOpen: false };

  it("is Ctrl+B off macOS and Cmd+B on macOS, with no other modifier", () => {
    expect(isSidebarChord(key(), false)).toBe(true);
    expect(isSidebarChord(key({ key: "B" }), false)).toBe(true);
    expect(isSidebarChord(key({ ctrlKey: false, metaKey: true }), true)).toBe(true);
    expect(isSidebarChord(key({ ctrlKey: false, metaKey: true }), false)).toBe(false);
    expect(isSidebarChord(key(), true)).toBe(false);
    expect(isSidebarChord(key({ shiftKey: true }), false)).toBe(false);
    expect(isSidebarChord(key({ altKey: true }), false)).toBe(false);
    expect(isSidebarChord(key({ key: "k" }), false)).toBe(false); // Ctrl+K is the search palette's
  });

  it("labels the chord per platform", () => {
    expect([sidebarChordLabel(false), sidebarChordLabel(true)]).toEqual(["Ctrl+B", "⌘B"]);
  });

  it("recognises typing targets", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
    expect(isTypingTarget({ tagName: "INPUT", type: "search" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "BODY" })).toBe(false);
  });

  it("toggles on the chord, but not while typing, with a dialog or menu open, held down or composing", () => {
    expect(toggles(key(), false, free)).toBe(true);
    expect(toggles(key(), false, { ...free, typing: true })).toBe(false);
    expect(toggles(key(), false, { ...free, layerOpen: true })).toBe(false);
    expect(toggles({ ...key(), repeat: true }, false, free)).toBe(false);
    expect(toggles({ ...key(), isComposing: true }, false, free)).toBe(false);
    expect(toggles(key({ key: "x" }), false, free)).toBe(false);
  });
});
