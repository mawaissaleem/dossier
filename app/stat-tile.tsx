import Link from "next/link";
import { cn } from "@/lib/utils";

// One stat tile of the dashboard's top row (DESIGN.md "Dashboard"): a muted label, a big value and one muted hint line, the whole tile one link.
// The link's name is its text ("Overdue 2 PhD · X, 2 days late"). `lead` is an optional figure beside the label and value (the week's ring, which carries its own label).
// `alert` = the destructive token on the border and the value (Overdue, when there is any). The hint keeps 3 lines and then clamps, with its full text in `title`.
export function StatTile({ href, label, value, hint, lead, alert, className }: {
  href: string; label: string; value: React.ReactNode; hint: string; lead?: React.ReactNode; alert?: boolean; className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        alert ? "border-destructive" : "border-border",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2 sm:gap-3">
        {lead}
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <span className={cn("break-words text-xl font-semibold tracking-tight tabular-nums sm:text-2xl", alert && "text-destructive")}>{value}</span>
        </span>
      </span>
      <span title={hint} className="line-clamp-3 break-words text-sm text-muted-foreground">{hint}</span>
    </Link>
  );
}
