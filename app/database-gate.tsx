import { connection } from "next/server";
import { TriangleAlertIcon } from "lucide-react";
import { Page, PageHeader } from "@/components/page-header";
import { UPDATE_STEPS, UPDATE_TITLE, pendingMigrations, updateIntro } from "@/lib/db/migrations";
import { plannedBackupFolder } from "@/lib/files/update";
import { UpdateDatabaseForm } from "./update-database-form";

// Wraps every page (app/layout.tsx). A database behind the app's migrations would crash the page with "no such table",
// so when updates are pending the page is not rendered at all and this calm message stands in its place, still inside
// the app frame, with the one-click "Back up and update". Request-time (it reads the database), so the layout puts it
// inside a Suspense boundary. Existing data is only migrated when the user presses that button; a brand-new database is
// created by pendingMigrations() itself and never gets here.
export async function DatabaseGate({ children }: { children: React.ReactNode }) {
  await connection();
  const pending = pendingMigrations();
  if (pending === 0) return children;
  const folder = await plannedBackupFolder();
  return (
    <Page narrow>
      <PageHeader title={UPDATE_TITLE} description={updateIntro(pending)} />
      <div role="status" className="rounded-md border border-warning bg-muted p-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-warning" />
          {pending} {pending === 1 ? "update" : "updates"} to apply
        </p>
        <p className="mt-2 break-words">
          Dossier will first save a backup copy of your database to <span className="font-medium">{folder}</span>, then
          update it. This takes a few seconds.
        </p>
        <UpdateDatabaseForm />
        <details className="mt-4">
          <summary className="w-fit cursor-pointer rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Prefer the terminal?
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-9">
            {UPDATE_STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </details>
      </div>
    </Page>
  );
}
