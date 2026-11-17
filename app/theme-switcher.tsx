"use client";

import { useId, useLayoutEffect, useSyncExternalStore } from "react";
import { PaletteIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DEFAULT_THEME, THEMES, THEME_LABELS, THEME_STORAGE_KEY, parseTheme } from "@/lib/theme";
import { RAIL_ITEM, RailTip } from "./rail";

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
  const theme = useSyncExternalStore(subscribe, () => parseTheme(document.documentElement.dataset.theme), () => DEFAULT_THEME);
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

// The labelled select on the Settings page.
export function ThemeSwitcher({ className }: { className?: string }) {
  const id = useId();
  const [theme, setTheme] = useTheme();
  return (
    <div className={cn("grid gap-1", className)}>
      <Label htmlFor={id}>Theme</Label>
      <NativeSelect id={id} value={theme} onChange={(e) => setTheme(e.target.value)}>
        {THEMES.map((t) => (
          <NativeSelectOption key={t} value={t}>{THEME_LABELS[t]}</NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

// The rail's theme item: an icon that opens a menu of the three themes (the current one checked).
export function ThemeMenu({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Theme: ${THEME_LABELS[theme]}`} className={cn(RAIL_ITEM, className)}>
          <PaletteIcon aria-hidden />
          <RailTip>Theme</RailTip>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={20} className="w-auto min-w-36">
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          {THEMES.map((t) => <DropdownMenuRadioItem key={t} value={t}>{THEME_LABELS[t]}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
