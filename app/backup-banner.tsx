import { connection } from "next/server";
import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";
import { reminderMessage } from "@/lib/backup-reminder";
import { getBackupReminder } from "@/lib/db/backup";

// App-wide backup reminder (FR-12.2). Warning style from DESIGN.md; in the page flow, never over content. Request-time (the DB), so the
// layout puts it inside a Suspense boundary. A failed read shows nothing rather than breaking every page.
export async function BackupBanner() {
  await connection();
  const reminder = await getBackupReminder().catch(() => null);
  if (!reminder) return null;
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-warning bg-muted p-3 text-sm">
      <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 break-words">{reminderMessage(reminder)}</span>
      <Link href="/settings#backup" className="shrink-0 rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">Open backup settings</Link>
    </div>
  );
}
