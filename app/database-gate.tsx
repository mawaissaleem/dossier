import { connection } from "next/server";
import { TriangleAlertIcon } from "lucide-react";
import { Page, PageHeader } from "@/components/page-header";
import { UPDATE_STEPS, UPDATE_TITLE, pendingMigrations, updateIntro } from "@/lib/db/migrations";

// Wraps every page (app/layout.tsx). A database behind the app's migrations would crash the page with "no such table", so when updates are
// pending the page is not rendered at all and this calm message stands in its place, still inside the app frame. Request-time (it reads the
// database), so the layout puts it inside a Suspense boundary. The app never migrates by itself.
export async function DatabaseGate({ children }: { children: React.ReactNode }) {
  await connection();
  const pending = pendingMigrations();
  if (pending === 0) return children;
  return (
    <Page narrow>
      <PageHeader title={UPDATE_TITLE} description={updateIntro(pending)} />
      <div role="status" className="rounded-md border border-warning bg-muted p-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-warning" />
          To update it, follow these steps in order
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-9">
          {UPDATE_STEPS.map((s) => <li key={s}>{s}</li>)}
        </ol>
      </div>
    </Page>
  );
}
