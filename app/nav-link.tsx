"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { RAIL_ACTIVE, RAIL_ITEM, RailTip } from "./rail";

// One icon of the rail. The icon is the whole visible content; `label` is the accessible name and the tooltip.
export function NavLink({ href, icon, label, className }: { href: string; icon: React.ReactNode; label: string; className?: string }) {
  const path = usePathname();
  // Prefix match so /tracks/1 keeps "Tracks" lit; "/" stays exact.
  const active = href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
  // Only the exact page is aria-current="page"; a section parent is "true", so /tracks/1 has one "page" (its track tab).
  return (
    <Link href={href} aria-label={label} aria-current={path === href ? "page" : active ? "true" : undefined} className={cn(RAIL_ITEM, active && RAIL_ACTIVE, className)}>
      {icon}
      <RailTip>{label}</RailTip>
    </Link>
  );
}
