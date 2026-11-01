"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  // Prefix match so /tracks/1 keeps "Tracks" lit; "/" stays exact.
  const active = href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded px-3 py-2 text-sm ${
        active ? "bg-foreground/10 font-semibold" : "hover:bg-foreground/5"
      }`}
    >
      {children}
    </Link>
  );
}
