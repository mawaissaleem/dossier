"use client";

import { useId, useState, useTransition } from "react";
import { PlusIcon } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { createTrack } from "@/app/actions/tracks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_TRACK_NAME, TEMPLATES, TEMPLATE_IDS, isTemplateId, type TemplateId } from "@/lib/track-templates";

// "Add track": a template (Job, PhD or Blank) and a name, prefilled from the template until the user types their own.
// The dialog stays open on an error (duplicate name).
export function AddTrack({ size }: { size?: "sm" }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<TemplateId>("job");
  const [name, setName] = useState(TEMPLATES.job.defaultName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pick(v: string) {
    if (!isTemplateId(v)) return;
    if (name === TEMPLATES[template].defaultName) setName(TEMPLATES[v].defaultName); // the name was still the prefill
    setTemplate(v);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const r = await createTrack(name, template);
        if (r.ok) setOpen(false);
        else setError(r.error);
      } catch {
        setError("Could not add the track. Try again.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        if (o) {
          setTemplate("job");
          setName(TEMPLATES.job.defaultName);
          setError(null);
        }
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size={size}>
          <PlusIcon aria-hidden />
          Add track
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add track</DialogTitle>
            <DialogDescription>
              A template sets up the columns, statuses and expected files. Everything stays editable afterwards.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup.Root value={template} onValueChange={pick} aria-label="Template" className="grid gap-2">
            {TEMPLATE_IDS.map((id) => (
              <RadioGroup.Item
                key={id}
                value={id}
                className="flex flex-col items-start gap-0.5 rounded-md border border-input px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-foreground data-[state=checked]:bg-muted"
              >
                <span className="text-sm font-medium">{TEMPLATES[id].label}</span>
                <span className="text-xs text-muted-foreground">{TEMPLATES[id].hint}</span>
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-name`}>Name</Label>
            <Input
              id={`${uid}-name`}
              required
              maxLength={MAX_TRACK_NAME}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add track"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
