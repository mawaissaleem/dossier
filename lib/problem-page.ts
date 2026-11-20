// The small HTML pages the file routes answer with (409 "file changed", zip "files need attention", "files folder not
// available"). They open in a tab outside the app shell, so they carry their own inline CSS, with the theme token
// values: Graphite by default, Paper when the system prefers light. No external assets.
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const CSS =
  `:root{color-scheme:dark light;--bg:#0d0f0f;--fg:#e7ebea;--muted:#9ba5a2;--border:#2b3232;--link:#34d399}` +
  `@media (prefers-color-scheme:light){:root{--bg:#e9e7e1;--fg:#1c1b18;--muted:#57534a;--border:#cfcbc1;--link:#0b6860}}` +
  `body{margin:0 auto;max-width:40rem;padding:2rem 1rem;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}` +
  `h1{font-size:1.25rem;margin:0 0 1rem}p,ul{margin:0 0 1rem}li{margin:.25rem 0}a{color:var(--link)}` +
  `.back{border-top:1px solid var(--border);padding-top:1rem;color:var(--muted)}`;

// `bodyHtml` is trusted markup built by the caller (names escaped with `esc`); applicationId comes from a database row,
// never the request.
export function problemPage(
  status: number,
  title: string,
  bodyHtml: string,
  applicationId: number,
  headers: Record<string, string>,
): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style>` +
      `<h1>${esc(title)}</h1>${bodyHtml}<p class="back"><a href="/applications/${applicationId}" target="_top">Back to the application</a></p>`,
    {
      status,
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'",
      },
      // frame-ancestors: the Preview dialog shows these in its frame. no sandbox: a sandboxed page's link click would
      // reach the guard as cross-site
    },
  );
}

// The files folder is unset or gone (the Open link and the zip link open in a tab, so a JSON body would be a bare
// error). `error` is a fixed message from lib/files, not user input, but it is escaped anyway.
export const setupPage = (error: string, applicationId: number, headers: Record<string, string>): Response =>
  problemPage(
    409,
    "The files folder is not available",
    `<p>${esc(error)}</p><p><a href="/settings" target="_top">Open Settings</a></p>`,
    applicationId,
    headers,
  );
