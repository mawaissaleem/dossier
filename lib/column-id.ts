// The table column id of a track column. Its own dependency-free module so the pure sort and filter modules do not pull in TanStack.
export const columnId = (c: { id: number }) => `col-${c.id}`;
