"use client";

import { ShieldCheckIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { checkFiles } from "@/app/actions/files";
import { Button } from "@/components/ui/button";

// "Check files" (FR-5.5): re-verifies every file of this application and refreshes the badges. The result is one status line
// (a live region that is always mounted, so a screen reader announces the text when it appears); a failure is a role="alert" line.
export function CheckFiles({ applicationId }: { applicationId: number }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  function run() {
    if (pending) return; // aria-disabled, not disabled: a disabled button would drop keyboard focus
    setResult(null);
    startTransition(async () => {
      try {
        const r = await checkFiles(applicationId);
        setResult({ ok: r.ok, text: r.ok ? r.summary : r.error });
      } catch {
        setResult({ ok: false, text: "The check failed. Try again." });
      }
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" size="sm" onClick={run} aria-disabled={pending}>
        <ShieldCheckIcon aria-hidden /> {pending ? "Checking…" : "Check files"}
      </Button>
      <p role="status" className="text-sm text-muted-foreground">{result?.ok ? result.text : ""}</p>
      {result && !result.ok && <p role="alert" className="text-sm text-destructive">{result.text}</p>}
    </div>
  );
}
