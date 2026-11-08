// Pure (no fs, no DB, no React). Logic behind the upload form on the detail page (5.8): label choice, size guard, response messages.
import { MAX_UPLOAD_BYTES } from "./upload-form";

export const CUSTOM_LABEL = ""; // select value for "Custom…"; a blank can never be a real label (getFileLabels drops blanks)

// One label applies to the whole batch. A custom choice uses the typed text (trimmed; the server validates it).
export const chooseLabel = (choice: string, custom: string) => (choice === CUSTOM_LABEL ? custom.trim() : choice);

// Refuses early what the route would refuse with 413. Counts file bytes only (the route also counts the form overhead).
export function sizeError(sizes: number[]): string | null {
  return sizes.reduce((a, b) => a + b, 0) > MAX_UPLOAD_BYTES ? "Too large (max 50 MB per upload). Choose fewer or smaller files." : null;
}

export type UploadOutcome = {
  ok: boolean;
  stored: string[]; // stored names created (also on a partial failure)
  duplicates: { originalName: string; storedName: string }[]; // FR-5.7: not stored, an identical file of this application exists
  message: string | null; // a general error line; null on success or when only fields are wrong
  fieldErrors: { label?: string; uploadDate?: string; files?: string };
  settingsLink: boolean; // the message is about the files root: show a Settings link
};

// Maps the route's answer (see app/api/applications/[id]/files/route.ts) to what the form shows. `body` is the parsed JSON or undefined.
export function describeResponse(status: number, body: unknown): UploadOutcome {
  const b = (body && typeof body === "object" ? body : {}) as { files?: unknown; duplicates?: unknown; error?: unknown; errors?: Record<string, unknown> };
  const stored = Array.isArray(b.files) ? b.files.flatMap((f) => (typeof f?.storedName === "string" ? [f.storedName] : [])) : [];
  const duplicates = Array.isArray(b.duplicates) ? b.duplicates.flatMap((d) => (typeof d?.originalName === "string" && typeof d?.storedName === "string" ? [{ originalName: d.originalName, storedName: d.storedName }] : [])) : [];
  const out = (message: string | null, extra: Partial<UploadOutcome> = {}): UploadOutcome => ({ ok: false, stored, duplicates, message, fieldErrors: {}, settingsLink: false, ...extra });
  if (status === 201 || status === 200) return out(null, { ok: true });
  if (status === 400 && b.errors) {
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const fieldErrors = { label: str(b.errors.label), uploadDate: str(b.errors.uploadDate), files: str(b.errors.files) };
    return out(Object.values(fieldErrors).some(Boolean) ? null : "Check the fields and try again.", { fieldErrors });
  }
  if (status === 400) return out("The upload was not understood. Try again.");
  if (status === 403) return out("Refused: uploads only work from this computer's own address.");
  if (status === 404) return out("This application no longer exists. Nothing was saved.");
  if (status === 409) return out(typeof b.error === "string" && b.error ? b.error : "The files folder is not set or cannot be used.", { settingsLink: true });
  if (status === 413) return out("Too large (max 50 MB per upload). Nothing was saved.");
  const detail = typeof b.error === "string" ? ` ${b.error}` : "";
  return out(`The upload failed.${detail}${stored.length ? " Files stored before the failure are kept." : ""}`);
}

export const duplicateMessage = (d: { originalName: string; storedName: string }) => `Identical file already uploaded: ${d.originalName} matches ${d.storedName}`;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
