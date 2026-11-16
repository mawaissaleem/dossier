// Pure (no DB, no UI). Which files the Preview dialog (FR-5.9, 13.3/13.4) offers, in what order, and how Previous/Next move.
import { previewKind } from "./file-serve";

export type PreviewItem = { id: number; name: string; storedName: string; kind: "pdf" | "image" };

// The previewable files of one list (the Files list, or one submission), in the list's own order. A deleted file (tombstone) has no bytes: never offered.
// Images join the PDFs in the same sequence: they are served inline by the same route, and a reader going through "what was sent" wants all of it.
export function previewItems(files: { id: number; originalName: string; storedName: string; deletedAt?: unknown }[]): PreviewItem[] {
  return files.flatMap((f) => {
    const kind = previewKind(f.storedName);
    return kind && !f.deletedAt ? [{ id: f.id, name: f.originalName, storedName: f.storedName, kind }] : [];
  });
}

// No wrap: the first file has no Previous and the last has no Next (the "2 of 3" position says where you are, and wrapping would silently
// restart a read). null = there is no such neighbour.
export const stepIndex = (index: number, count: number, delta: -1 | 1): number | null => {
  const to = index + delta;
  return index >= 0 && index < count && to >= 0 && to < count ? to : null;
};

export const positionLabel = (index: number, count: number): string => `${index + 1} of ${count}`;
