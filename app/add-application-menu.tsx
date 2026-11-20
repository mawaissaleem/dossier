"use client";

import Link from "next/link";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TrackMarker } from "./track-marker";

// "Add application" with more than one track: pick the track, then land on its add form (`#add-application`,
// app/tracks/[id]/page.tsx). Items are real links.
export function AddApplicationMenu({ tracks }: { tracks: { id: number; name: string; color: string }[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button">
          <PlusIcon aria-hidden />
          Add application
          <ChevronDownIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        {tracks.map((t) => (
          <DropdownMenuItem key={t.id} asChild>
            <Link href={`/tracks/${t.id}#add-application`}>
              <TrackMarker name={t.name} color={t.color} className="size-5 text-[11px]" />
              {t.name}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
