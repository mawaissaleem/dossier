import type { OptionItem } from "@/lib/db/columns";
import { chipClasses } from "@/lib/colors";

// Read-only coloured label of a single-select option. The label and colour come from the current option, so rename/recolour shows everywhere (FR-3.3).
export function OptionChip({ option }: { option: Pick<OptionItem, "label" | "color"> }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-sm ${chipClasses(option.color)}`}>{option.label}</span>;
}
