import { cookies } from "next/headers";
import { CircleCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UPDATED_COOKIE } from "@/lib/files/update";
import { dismissUpdatedNote } from "./actions/database";

// One-shot note after "Back up and update": the action sets a short-lived cookie with the safety backup path, this shows it until dismissed
// (or ten minutes pass). Request-time (cookies), so the layout puts it inside a Suspense boundary.
export async function UpdatedNote() {
  const path = (await cookies()).get(UPDATED_COOKIE)?.value;
  if (!path) return null;
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted p-3 text-sm">
      <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 break-words">Database updated. Safety backup: <span className="font-medium">{path}</span></span>
      <form action={dismissUpdatedNote}><Button variant="ghost" size="sm">Dismiss</Button></form>
    </div>
  );
}
