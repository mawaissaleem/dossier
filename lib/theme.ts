// Pure: theme names, validation of the stored choice, and the pre-paint script. No DOM or React imports.
export const THEMES = ["graphite", "ink", "paper"] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = "graphite";
export const THEME_LABELS: Record<Theme, string> = { graphite: "Graphite", ink: "Ink", paper: "Paper" };
export const THEME_STORAGE_KEY = "dossier-theme";

// Anything unknown, missing or tampered falls back to Graphite.
export const parseTheme = (v: unknown): Theme => (THEMES as readonly unknown[]).includes(v) ? (v as Theme) : DEFAULT_THEME;

// Inline script for <head>: runs while the HTML is parsed, before first paint. It validates the stored value like parseTheme does.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});document.documentElement.setAttribute("data-theme",${JSON.stringify(THEMES)}.indexOf(t)>-1?t:${JSON.stringify(DEFAULT_THEME)})}catch(e){}})()`;
