import { Page, PageHeader } from "@/components/page-header";
import { ThemeSwitcher } from "../theme-switcher";

export default function SettingsPage() {
  return (
    <Page narrow>
      <PageHeader title="Settings" />
      <section aria-labelledby="appearance">
        <h2 id="appearance" className="mb-2 text-lg font-semibold">Appearance</h2>
        <ThemeSwitcher className="max-w-48" />
        <p className="mt-2 text-sm text-muted-foreground">Graphite is the default dark theme, Ink a cooler blue-black one, Paper a light one. The choice is saved in this browser.</p>
      </section>
    </Page>
  );
}
