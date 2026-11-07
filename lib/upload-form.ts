// Pure (no fs, no DB). Validates the text fields of an upload (5.7): the label (FR-5.3) and the upload date (FR-6.4).
// The editable label list does not exist yet, so any short single-line text is accepted for now.
import { isValidDate, todayLocal } from "./filename";

export const MAX_LABEL = 60;
export type UploadFields = { label: string; uploadDate: string };
export type UploadFieldsResult = { ok: true; fields: UploadFields } | { ok: false; errors: { label?: string; uploadDate?: string } };

// A missing or blank date means today (server local time); a missing label is an error.
export function parseUploadFields(label: unknown, date: unknown, today: string = todayLocal()): UploadFieldsResult {
  const errors: { label?: string; uploadDate?: string } = {};
  const l = typeof label === "string" ? label.trim() : "";
  if (l === "") errors.label = "Choose a label.";
  else if (l.length > MAX_LABEL || /[\u0000-\u001f\u007f-\u009f]/.test(l)) errors.label = `Label must be one line of at most ${MAX_LABEL} characters.`;
  const d = date === null || date === undefined || (typeof date === "string" && date.trim() === "") ? today : date;
  if (typeof d !== "string" || !isValidDate(d)) errors.uploadDate = "Use a real date as YYYY-MM-DD.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, fields: { label: l, uploadDate: d as string } };
}
