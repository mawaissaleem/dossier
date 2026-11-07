import Link from "next/link";
import { Page, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <Page narrow>
      <PageHeader title="Not found" description="This page does not exist, or the application was deleted." />
      <Button asChild variant="outline"><Link href="/tracks">Go to Tracks</Link></Button>
    </Page>
  );
}
