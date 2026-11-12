import Link from "next/link";
import { connection } from "next/server";
import { localToday } from "@/lib/deadline";
import { getUpcomingDeadlines } from "@/lib/db/planner";
import { DashboardCard, ROW_LINK as LINK } from "./dashboard-card";

// FR-9.3: the nearest deadline big, then the next 3 as small rows. Overdue ones are the overdue card's (11.4), not here.
export async function DeadlineCard({ className }: { className?: string }) {
  await connection();
  const [first, ...next] = await getUpcomingDeadlines(localToday(), 4);
  return (
    <DashboardCard title="Next deadline" link={{ href: "/planner", label: "Open Planner" }} className={className}>
      {!first ? (
        <p className="text-sm text-muted-foreground">No upcoming deadlines.</p>
      ) : (
        <>
          {/* The number and unit are two inline spans with a real space between them, so a screen reader says "3 days". */}
          <p className="font-semibold tracking-tight tabular-nums">
            <span className="text-display">{first.big}</span>
            {first.unit && <>{" "}<span className="text-xl text-muted-foreground">{first.unit}</span></>}
          </p>
          <div className="mt-2 min-w-0">
            <Link href={`/applications/${first.id}`} className={`break-words font-medium ${LINK}`}>{first.title}</Link>
            <p className="text-sm text-muted-foreground">{first.trackName} · {first.date}</p>
          </div>
          {next.length > 0 && (
            <ul className="mt-4 flex flex-col">
              {next.map((d) => (
                <li key={d.id} className="flex items-baseline justify-between gap-3 border-t border-border py-2 text-sm last:pb-0">
                  <Link href={`/applications/${d.id}`} className={`min-w-0 break-words ${LINK}`}>{d.title}</Link>
                  <span className="shrink-0 tabular-nums text-muted-foreground"><span className="sr-only">Due </span>{d.text} · {d.date}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </DashboardCard>
  );
}
