import Link from "next/link";
import { CircleAlertIcon } from "lucide-react";
import { connection } from "next/server";
import { localToday } from "@/lib/deadline";
import { firstN, type OverdueAlert } from "@/lib/dashboard";
import { getOverdueAlerts } from "@/lib/db/planner";
import { ACCENT_LINK, DashboardCard, ROW_LINK as LINK } from "./dashboard-card";

const SHOWN = 5;

// FR-9.5: red rows that open the application. Nothing overdue renders nothing at all (no empty red card).
function Rows({ items }: { items: OverdueAlert[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((d) => (
        <li key={d.id} className="border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link href={`/applications/${d.id}`} className={`break-words font-medium text-destructive ${LINK}`}>{d.title}</Link>
            <span className="text-xs text-muted-foreground">{d.trackName}</span>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm font-medium text-destructive">
            <CircleAlertIcon aria-hidden className="size-3.5 shrink-0" />
            <span>{d.text}</span>
            <span className="font-normal tabular-nums">· <span className="sr-only">due </span>{d.date}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

export async function OverdueCard({ className }: { className?: string }) {
  await connection();
  const items = await getOverdueAlerts(localToday());
  if (!items.length) return null;
  const { shown, more } = firstN(items, SHOWN);
  return (
    <DashboardCard title="Overdue" count={items.length} className={className}>
      <Rows items={shown} />
      {/* No link target lists them all (the planner hides overdue under its "hide" rule), so the rest opens in place. */}
      {more > 0 && (
        <details className="mt-3 border-t border-border pt-3 text-sm">
          <summary className={`w-fit cursor-pointer ${ACCENT_LINK}`}>{more} more</summary>
          <div className="mt-3"><Rows items={items.slice(SHOWN)} /></div>
        </details>
      )}
    </DashboardCard>
  );
}
