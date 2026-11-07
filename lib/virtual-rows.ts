// Pure windowing helpers for the virtualised track table (task 4.5). No DB, React or TanStack imports.

// Fixed pixel widths (the table uses table-layout: fixed, so a column never resizes while rows scroll in and out of the window).
export const COLUMN_WIDTH = { title: 300, text: 208, number: 144, date: 152, link: 220, checkbox: 104, single_select: 160, add: 40 } as const;
export const columnWidth = (type: keyof typeof COLUMN_WIDTH) => COLUMN_WIDTH[type];
// The inline editor's minimum width and a body cell's horizontal padding (px-2 on both sides): every editable column fits the editor.
// Hand-kept: 16 = 2 x 8 px = the body cell's `px-2` class in app/tracks/[id]/virtual-rows.tsx (const cell); change both together.
export const EDITOR_MIN_WIDTH = 128;
export const CELL_PADDING_X = 16;

// The row indexes to mount: the window plus the rows that must stay mounted (focused or being edited), sorted, unique, in range.
export function withPinned(window: number[], pinned: number[], count: number): number[] {
  const out = new Set(window);
  for (const i of pinned) if (i >= 0 && i < count) out.add(i);
  return [...out].sort((a, b) => a - b);
}

export type Item = { index: number; start: number; end: number };

// Heights of the empty rows that stand in for the rows that are not mounted. before[i] is the gap above items[i] (the previous
// item's end, or the table body's start, which is `margin` when the header sits above it); after is the gap below the last item.
// A pinned row far from the window leaves a gap in the middle, which is why this is per item and not just top and bottom.
export function spacers(items: Item[], totalSize: number, margin = 0): { before: number[]; after: number } {
  let at = margin;
  const before = items.map((it) => {
    const gap = Math.max(0, it.start - at);
    at = it.end;
    return gap;
  });
  return { before, after: Math.max(0, totalSize + margin - at) };
}
