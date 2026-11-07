"use client";

import { useId, useLayoutEffect, useSyncExternalStore } from "react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DEFAULT_THEME, THEMES, THEME_LABELS, THEME_STORAGE_KEY, parseTheme } from "@/lib/theme";

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

export function ThemeSwitcher({ className }: { className?: string }) {
  const id = useId();
  const theme = useSyncExternalStore(subscribe, () => parseTheme(document.documentElement.dataset.theme), () => DEFAULT_THEME);
  // React's dev-mode remount can clear attributes set by the inline script; re-apply the stored choice (no-op in production).
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", readStored());
  }, []);

  return (
    <div className={cn("grid gap-1", className)}>
      <Label htmlFor={id}>Theme</Label>
      <NativeSelect
        id={id}
        value={theme}
        onChange={(e) => {
          const next = parseTheme(e.target.value);
          document.documentElement.setAttribute("data-theme", next);
          try {
            localStorage.setItem(THEME_STORAGE_KEY, next);
          } catch {
            // Storage blocked: the theme still applies for this page view.
          }
        }}
      >
        {THEMES.map((t) => (
          <NativeSelectOption key={t} value={t}>{THEME_LABELS[t]}</NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
