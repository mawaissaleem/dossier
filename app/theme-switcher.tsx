"use client";

import { useId, useLayoutEffect, useSyncExternalStore } from "react";
import { CheckIcon, PaletteIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { DEFAULT_THEME, THEMES, type Theme, THEME_LABELS, THEME_STORAGE_KEY, parseTheme } from "@/lib/theme";
import { RAIL_ITEM, RailLabel, RailTip } from "./rail";

// The <html data-theme> attribute is the source of truth (set before paint by THEME_INIT_SCRIPT), so several switchers stay in sync.
const subscribe = (cb: () => void) => {
  const o = new MutationObserver(cb);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => o.disconnect();
};
const readStored = () => {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
};

function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => parseTheme(document.documentElement.dataset.theme),
    () => DEFAULT_THEME,
  );
  // React's dev-mode remount can clear attributes set by the inline script; re-apply the stored choice (no-op in production).
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", readStored());
  }, []);
  const set = (value: string) => {
    const next = parseTheme(value);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the theme still applies for this page view.
    }
  };
  return [theme, set] as const;
}

// A small preview of one theme: data-theme on the element makes it resolve that theme's tokens (every token is a scoped custom property), so no colour is written here.
const ThemeDot = ({ theme }: { theme: Theme }) => (
  <span
    data-theme={theme}
    aria-hidden
    className="grid size-4 shrink-0 place-items-center rounded-full border border-input bg-background"
  >
    <span className="size-2 rounded-full bg-accent" />
  </span>
);

// The Settings picker: native radios in one group (one tab stop, arrow keys move and select), each a card that previews the theme (canvas, a card strip, the accent gradient).
export function ThemeSwitcher({ className }: { className?: string }) {
  const name = useId();
  const [theme, setTheme] = useTheme();
  return (
    <fieldset className={cn("grid gap-2", className)}>
      <legend className="mb-1 text-sm font-medium">Theme</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {THEMES.map((t) => (
          <label key={t} className="relative block cursor-pointer">
            <input
              type="radio"
              name={name}
              value={t}
              checked={theme === t}
              onChange={() => setTheme(t)}
              className="peer sr-only"
            />
            <span className="block rounded-lg border-2 border-input p-1 transition-colors peer-checked:border-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background">
              <span data-theme={t} aria-hidden className="grid gap-1.5 rounded-md bg-background p-2">
                <span className="h-5 rounded-sm border border-border bg-card" />
                <span className="h-1.5 rounded-full bg-linear-to-r from-accent to-accent-to" />
              </span>
            </span>
            <span className="mt-1.5 flex items-center gap-1 text-sm peer-checked:font-semibold">
              {THEME_LABELS[t]}
              {theme === t && <CheckIcon aria-hidden className="size-3.5 text-accent" />}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// The sidebar's theme item: an icon (and, expanded, the word Theme) that opens a menu of the themes, each with a swatch (the current one checked).
export function ThemeMenu({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Theme: ${THEME_LABELS[theme]}`} className={cn(RAIL_ITEM, className)}>
          <PaletteIcon aria-hidden />
          <RailLabel>Theme</RailLabel>
          <RailTip>Theme</RailTip>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={20} className="w-auto min-w-36">
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          {THEMES.map((t) => (
            <DropdownMenuRadioItem key={t} value={t}>
              <ThemeDot theme={t} />
              {THEME_LABELS[t]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
