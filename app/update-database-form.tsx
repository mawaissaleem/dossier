"use client";

import { useActionState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { backUpAndUpdate } from "@/app/actions/database";

// The gate page's button. Disabled while the update runs (and until the redirect lands); a failure shows under it.
export function UpdateDatabaseForm() {
  const [state, action, pending] = useActionState(backUpAndUpdate, null);
  const pathname = usePathname();
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="returnTo" value={pathname} />
      <Button type="submit" disabled={pending}>{pending ? "Updating…" : "Back up and update"}</Button>
      {state && <p role="alert" className="mt-3 rounded-md border border-destructive bg-card p-3 text-sm break-words">{state.error}</p>}
    </form>
  );
}
