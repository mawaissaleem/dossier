"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { safeReturnPath } from "@/lib/db/migrations";
import { UPDATED_COOKIE, updateDatabase } from "@/lib/files/update";

// The gate page's "Back up and update" button (useActionState). Runs on any POST, so every input is checked; it does
// nothing when no updates are pending. On success it sends the user back to the page they were on (or /); only a
// failure returns.
export async function backUpAndUpdate(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  let r;
  try {
    r = await updateDatabase();
  } catch (e) {
    return { error: `The update failed (${(e as Error).message}). Your data was not changed.` };
  }
  if (!r.ok) return { error: r.error };
  if (r.backupPath)
    (await cookies()).set(UPDATED_COOKIE, r.backupPath, { path: "/", maxAge: 600, httpOnly: true, sameSite: "lax" });
  redirect(safeReturnPath(formData.get("returnTo")));
}

export async function dismissUpdatedNote() {
  (await cookies()).delete(UPDATED_COOKIE);
}
