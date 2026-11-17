// The pieces every item of the sidebar shares (DESIGN.md "App frame"). Collapsed (the default) it is the icon rail: a 44px `rounded-md` icon target and its tooltip. Expanded (`wide:`, see globals.css: the
// expanded desktop sidebar and the phone panel) the same element becomes a full-width row: icon, label, optional hint. One element and one accessible name (`aria-label`) in both states.
export const RAIL_ITEM =
  "group/rail relative flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-muted aria-expanded:text-foreground [&_svg]:size-5 wide:h-10 wide:w-full wide:justify-start wide:gap-3 wide:px-3 wide:text-sm wide:font-medium";

// The active page: `bg-muted`, an accent icon and the 3px accent-gradient bar on the sidebar's left edge (one of the allowed gradients; the 72px rail leaves 14px each side of the item, the expanded sidebar 12px). No bar in the top bar (the phone panel has it).
// Expanded, the label turns foreground and only the icon stays accent (small text on `bg-muted` is safer in the foreground colour).
export const RAIL_ACTIVE =
  "bg-muted text-accent before:absolute before:inset-y-2.5 before:-left-3.5 before:w-0.75 before:rounded-full before:bg-linear-to-b before:from-accent before:to-accent-to max-md:before:hidden wide:before:block wide:text-foreground wide:before:-left-3 wide:[&_svg]:text-accent";

// The visible text of an expanded item (the collapsed rail shows the icon only; the name is in `aria-label`, so this is not read twice).
export function RailLabel({ children }: { children: React.ReactNode }) {
  return <span className="hidden min-w-0 truncate wide:inline">{children}</span>;
}

// The tooltip is CSS only, so it shows on hover and on keyboard focus. It is hidden from assistive technology (the item's own `aria-label` is its name), below `md` (the top bar of icons), while the sidebar is
// expanded (the labels are visible then) and after Escape (`<html data-tips-off>`, set by the sidebar controller until the pointer or focus moves to another item).
export function RailTip({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-full z-50 ml-5 hidden -translate-y-1/2 rounded-md border border-border bg-popover px-2.5 py-1 text-sm font-medium whitespace-nowrap text-popover-foreground shadow-lg md:group-hover/rail:block md:group-focus-visible/rail:block wide:hidden! in-data-[tips-off]:hidden!"
    >
      {children}
    </span>
  );
}
