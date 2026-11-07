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
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-muted font-semibold text-foreground" : "text-muted-foreground",
      )}
    >
      <span aria-hidden className={cn("flex [&_svg]:size-4", active && "text-accent")}>{icon}</span>
      {children}
    </Link>
  );
}
