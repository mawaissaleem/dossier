import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Content width rule (DESIGN.md): `narrow` pages (detail, settings, lists) are capped at max-w-3xl and left-aligned; the track page is full width.
export function Page({ narrow, children }: { narrow?: boolean; children: React.ReactNode }) {
  return <div className={cn(narrow && "max-w-3xl")}>{children}</div>;
}

// The only place an <h1> is written: title, optional back link, description and actions.
export function PageHeader({ title, back, description, actions }: {
  title: string;
  back?: { href: string; label: string };
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6">
      {back && (
        <Link
          href={back.href}
          className="mb-2 inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeftIcon aria-hidden className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold break-words">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
