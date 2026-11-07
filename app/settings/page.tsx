import { Suspense } from "react";
import { connection } from "next/server";
import { Page, PageHeader } from "@/components/page-header";
import { getFilesRoot } from "@/lib/db/settings";
import { ThemeSwitcher } from "../theme-switcher";
import { FilesRootForm } from "./files-root-form";

// The DB is request-time under cacheComponents, so this section sits inside a Suspense boundary.
async function FilesSection() {
  await connection();
  const root = await getFilesRoot();
  return (
    <>
      <p className="text-sm">
        Current files root: {root ? <code className="rounded bg-muted px-1.5 py-0.5 break-all">{root}</code> : <span className="text-muted-foreground">Not set yet</span>}
      </p>
      <FilesRootForm current={root} />
    </>
  );
}

export default function SettingsPage() {
  return (
    <Page narrow>
      <PageHeader title="Settings" />
      <section aria-labelledby="files" className="mb-8">
        <h2 id="files" className="mb-2 text-lg font-semibold">Files</h2>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <FilesSection />
        </Suspense>
        <p className="mt-2 text-sm text-muted-foreground">Uploaded files are stored in this folder. It must be an existing, writable folder outside the Dossier app folder. Changing it does not move files already stored.</p>
      </section>
      <section aria-labelledby="appearance">
        <h2 id="appearance" className="mb-2 text-lg font-semibold">Appearance</h2>
        <ThemeSwitcher className="max-w-48" />
        <p className="mt-2 text-sm text-muted-foreground">Graphite is the default dark theme, Ink a cooler blue-black one, Paper a light one. The choice is saved in this browser.</p>
      </section>
    </Page>
  );
}
