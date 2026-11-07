"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  const path = usePathname();
  // Prefix match so /tracks/1 keeps "Tracks" lit; "/" stays exact.
  const active = href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
  // Only the exact page is aria-current="page"; a section parent is "true", so /tracks/1 has one "page" (its track tab).
  return (
    <Link
      href={href}
      aria-current={path === href ? "page" : active ? "true" : undefined}
      className={cn(
        "relative flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        // Active: a 3px accent-gradient bar on the left edge (no text on it), one of the allowed gradients.
        active ? "bg-muted font-semibold text-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.75 before:rounded-full before:bg-linear-to-b before:from-accent before:to-accent-to" : "text-muted-foreground",
      )}
    >
      <span aria-hidden className={cn("flex [&_svg]:size-4", active && "text-accent")}>{icon}</span>
      {children}
    </Link>
  );
}
