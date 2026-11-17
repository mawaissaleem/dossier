import Link from "next/link";
import { splitValue } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

// One stat tile of the dashboard's top row (DESIGN.md "Dashboard"): a muted label, a big value (`text-4xl`, its unit muted and smaller: "3" + " days", "1" + " of 4") and one muted hint line, the whole tile one link.
// The link's name is its text ("Overdue 2 PhD · X, 2 days late"). `lead` is an optional figure beside the label and value (the week's ring, which carries its own label).
// `alert` = the destructive token on the border and the value (Overdue, when there is any). The hint keeps 3 lines and then clamps, with its full text in `title`.
export function StatTile({ href, label, value, hint, lead, alert, className }: {
  href: string; label: string; value: string; hint: string; lead?: React.ReactNode; alert?: boolean; className?: string;
}) {
  const { big, unit } = splitValue(value);
  return (
    <Link
      href={href}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        lead && "flex-row items-center gap-4",
        alert ? "border-destructive" : "border-border",
        className,
      )}
    >
      {lead}
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className={cn("break-words text-4xl font-semibold tracking-tight tabular-nums", alert && "text-destructive")}>
          {big}{unit && <span className="text-xl font-medium text-muted-foreground">{unit}</span>}
        </span>
        <span title={hint} className="line-clamp-3 break-words text-sm text-muted-foreground">{hint}</span>
      </span>
    </Link>
  );
}
