// The pieces every item of the icon rail shares (DESIGN.md "App frame"): a 44px `rounded-md` icon target and its tooltip. The tooltip is CSS only, so it shows on hover and on keyboard
// focus; it is hidden from assistive technology (the item's own `aria-label` is its name) and below `md`, where the rail is a top bar of icons.
export const RAIL_ITEM = "group/rail relative flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-muted aria-expanded:text-foreground [&_svg]:size-5";

// The active page: `bg-muted`, an accent icon and the 3px accent-gradient bar on the rail's left edge (one of the allowed gradients; the 72px rail leaves 14px each side of the item). No bar in the top bar.
export const RAIL_ACTIVE = "bg-muted text-accent before:absolute before:inset-y-2.5 before:-left-3.5 before:w-0.75 before:rounded-full before:bg-linear-to-b before:from-accent before:to-accent-to max-md:before:hidden";

export function RailTip({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-full z-50 ml-5 hidden -translate-y-1/2 rounded-md border border-border bg-popover px-2.5 py-1 text-sm font-medium whitespace-nowrap text-popover-foreground shadow-lg md:group-hover/rail:block md:group-focus-visible/rail:block"
    >
      {children}
    </span>
  );
}

