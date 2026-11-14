import Link from "next/link";
import { connection } from "next/server";
import { firstN } from "@/lib/dashboard";
import { localToday } from "@/lib/deadline";
import { getWins } from "@/lib/db/wins";
import { noWinsText, winAge, winCountsText, type Win } from "@/lib/wins";
import { OptionChip } from "./option-chip";
import { ACCENT_LINK, DashboardCard, ROW_LINK } from "./dashboard-card";

const SHOWN = 5;

function Rows({ items, today }: { items: Win[]; today: string }) {
  return (
    <ul className="flex flex-col">
      {items.map((w) => {
        const age = winAge(w.since, today);
        return (
          <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
            <Link href={`/applications/${w.id}`} className={`break-words font-medium ${ROW_LINK}`}>{w.title}</Link>
            <span className="text-xs text-muted-foreground">{w.trackName}</span>
            <OptionChip option={w} />
            {age && <time title={age.date} className="text-sm text-muted-foreground">{age.text}</time>}
            {w.archived && <span className="inline-flex h-5 items-center rounded-sm border border-border bg-muted px-2 text-xs font-medium text-muted-foreground">Archived</span>}
          </li>
        );
      })}
    </ul>
  );
}

// FR-9.7: the good news (interviews, offers) kept on the home screen. Not rendered until a win status is configured; with none reached yet it is one calm line.
export async function WinsCard({ className }: { className?: string }) {
  await connection();
  const { labels, wins } = await getWins();
  if (!labels.length) return null;
  const today = localToday();
  const { shown, more } = firstN(wins, SHOWN);
  return (
    <DashboardCard title="Wins" count={wins.length || undefined} className={className}>
      {wins.length === 0 ? (
        <p className="text-sm text-muted-foreground">{noWinsText(labels)}.</p>
      ) : (
        <>
          <p className="mb-3 text-sm font-medium tabular-nums">{winCountsText(wins, labels)}</p>
          <Rows items={shown} today={today} />
          {more > 0 && (
            <details className="mt-3 border-t border-border pt-3 text-sm">
              <summary className={`w-fit cursor-pointer ${ACCENT_LINK}`}>{more} more</summary>
              <div className="mt-3"><Rows items={wins.slice(SHOWN)} today={today} /></div>
            </details>
          )}
        </>
      )}
    </DashboardCard>
  );
}
