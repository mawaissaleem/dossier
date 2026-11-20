// The Dossier logo glyph: a folder (the dossier) with a sheet rising out of its back and a check on the front (files
// kept, application tracked). Drawn like Lucide's icons (24 grid, 2px round stroke, no fill) so it sits in the same
// tile; app/icon.svg is the static copy for the browser tab.
export function DossierMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M7 8V4a1 1 0 0 1 1-1h7l4 4v3" />
      <path d="M15 3v4h4" />
      <path d="M3 9a1 1 0 0 1 1-1h4l2 2h10a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  );
}
