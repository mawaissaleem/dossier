import { Suspense } from "react";
import { connection } from "next/server";
import { Page, PageHeader } from "@/components/page-header";
import { getBackupDestination, getLastBackupAt } from "@/lib/db/backup";
import { getFileLabels, getFilesRoot } from "@/lib/db/settings";
import { getExpectedLabels, getSubmittedChoices } from "@/lib/db/track-settings";
import { listTracks } from "@/lib/db/tracks";
import { ThemeSwitcher } from "../theme-switcher";
import { ExpectedLabelsForm } from "./expected-labels-form";
import { BackupForm } from "./backup-form";
import { FilesRootForm } from "./files-root-form";
import { SubmittedForm } from "./submitted-form";

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

async function BackupSection() {
  await connection();
  const [dest, last] = await Promise.all([getBackupDestination(), getLastBackupAt()]);
  return (
    <>
      <p className="text-sm">{last ? <>Last backup: <time dateTime={last}>{new Date(last).toLocaleString()}</time></> : <span className="text-muted-foreground">Never backed up</span>}</p>
      <BackupForm current={dest} />
    </>
  );
}

async function SubmissionsSection() {
  await connection();
  const tracks = await listTracks();
  if (!tracks.length) return <p className="text-sm text-muted-foreground">No tracks yet.</p>;
  const forms = await Promise.all(tracks.map(async (t) => ({ t, choices: await getSubmittedChoices(t.id) })));
  return (
    <div className="flex flex-col gap-3">
      {forms.map(({ t, choices }) => <SubmittedForm key={t.id} trackId={t.id} trackName={t.name} choices={choices} />)}
    </div>
  );
}

async function ExpectedLabelsSection() {
  await connection();
  const [tracks, suggestions] = await Promise.all([listTracks(), getFileLabels()]);
  const forms = await Promise.all(tracks.map(async (t) => ({ t, labels: await getExpectedLabels(t.id) })));
  return (
    <div className="flex flex-col gap-3">
      {forms.map(({ t, labels }) => <ExpectedLabelsForm key={t.id} trackId={t.id} trackName={t.name} initial={labels} suggestions={suggestions} />)}
    </div>
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
      <section aria-labelledby="backup" className="mb-8">
        <h2 id="backup" className="mb-2 text-lg font-semibold">Backup</h2>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <BackupSection />
        </Suspense>
        <p className="mt-2 text-sm text-muted-foreground">Back up now writes one zip with the database and every file in your files folder. Type the full path of an existing folder outside the Dossier app folder and your files folder: a browser cannot open a folder picker for a path on this computer. A backup never overwrites an earlier one.</p>
      </section>
      <section aria-labelledby="submissions" className="mb-8">
        <h2 id="submissions" className="mb-2 text-lg font-semibold">Submissions</h2>
        <p className="mb-3 text-sm text-muted-foreground">Tick the statuses that count as submitted. Leave all unticked and no status counts as submitted for that track.</p>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <SubmissionsSection />
        </Suspense>
        <h3 id="expected-labels" className="mb-1 mt-6 text-base font-semibold">Expected file labels</h3>
        <p className="mb-3 text-sm text-muted-foreground">Before a submission is created, Dossier warns if the application has no file with one of these labels. Type your own or pick one of the labels used for uploads. Leave the list empty for no warning.</p>
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <ExpectedLabelsSection />
        </Suspense>
      </section>
      <section aria-labelledby="appearance">
        <h2 id="appearance" className="mb-2 text-lg font-semibold">Appearance</h2>
        <ThemeSwitcher className="max-w-48" />
        <p className="mt-2 text-sm text-muted-foreground">Graphite is the default dark theme, Ink a cooler blue-black one, Paper a light one. The choice is saved in this browser.</p>
      </section>
    </Page>
  );
}
