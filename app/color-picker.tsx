"use client";

import { CheckIcon } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { PALETTE, chipClasses } from "@/lib/colors";

// Colour picker: one swatch per palette token on the theme chip tokens. A Radix radio group, so it is one Tab stop and arrows move the choice.
// The selected swatch has a check and a solid foreground border (not colour alone); the accessible name is the token.
export function ColorPicker({ value, onChange, label }: { value: string; onChange: (token: string) => void; label: string }) {
  return (
    <RadioGroup.Root value={value} onValueChange={onChange} aria-label={label} orientation="horizontal" className="flex items-center gap-1">
      {PALETTE.map((t) => (
        <RadioGroup.Item
          key={t}
          value={t}
          aria-label={t}
          title={t}
          className={`flex size-5 items-center justify-center rounded-full border border-input outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-2 data-[state=checked]:border-foreground ${chipClasses(t)}`}
        >
          <RadioGroup.Indicator><CheckIcon aria-hidden="true" className="size-3" /></RadioGroup.Indicator>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
