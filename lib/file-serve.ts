// Pure (no fs, no DB). How a stored file is sent to the browser (5.10). Uploads are user-chosen and may be HTML, SVG or script, so the
// type comes from an allow-list by extension, never from the bytes, and everything off the list is a download.
const INLINE: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain; charset=utf-8",
};

// RFC 5987 value-chars: encodeURIComponent leaves ' ( ) * ! alone, so escape them too.
const encode5987 = (s: string) => encodeURIComponent(s).replace(/['()*!]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

// Content-Disposition from the stored name: an ASCII-only quoted fallback (anything else becomes "_", so no quote, backslash,
// CR/LF or non-ASCII reaches the header) plus the UTF-8 filename* form for clients that read it.
export function contentDisposition(disposition: "inline" | "attachment", name: string): string {
  const fallback = name.replace(/[^A-Za-z0-9._-]/g, "_") || "file";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encode5987(name)}`;
}

// CSP: everything gets "sandbox; default-src 'none'" except PDF. Chrome's built-in PDF viewer can't load inside a sandboxed document, so a
// PDF gets "default-src 'none'" only (checked to still render in Firefox's pdf.js). That is safe: Content-Type application/pdf plus nosniff
// means the bytes can never run as HTML on the app origin.
export function fileHeaders(storedName: string, sizeBytes: number): Headers {
  const dot = storedName.lastIndexOf(".");
  const type = dot > 0 ? INLINE[storedName.slice(dot + 1).toLowerCase()] : undefined;
  return new Headers({
    "Content-Type": type ?? "application/octet-stream",
    "Content-Length": String(sizeBytes),
    "Content-Disposition": contentDisposition(type ? "inline" : "attachment", storedName),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": type === "application/pdf" ? "default-src 'none'" : "sandbox; default-src 'none'",
    "Cache-Control": "no-store",
  });
}
