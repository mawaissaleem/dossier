import Link from "next/link";
import { cn } from "@/lib/utils";

// The dashboard card pattern (DESIGN.md "Dashboard"): a flat `bg-card` panel with a header (h2, optional count, optional link) and a body. Every dashboard card uses it.
// The two link styles inside cards (hover and focus included), so every card reads the same.
export const ACCENT_LINK = "rounded-sm text-accent underline outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
export const ROW_LINK = "rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export function DashboardCard({ title, count, link, className, children }: {
  title: string; count?: number; link?: { href: string; label: string }; className?: string; children: React.ReactNode;
}) {
  return (
    <section className={cn("min-w-0 rounded-lg border border-border bg-card", className)}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold tracking-tight">{title}{count !== undefined && ` · ${count}`}</h2>
        {link && <Link href={link.href} className={cn("text-sm", ACCENT_LINK)}>{link.label}<span className="sr-only"> from {title}</span></Link>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
