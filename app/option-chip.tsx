import type { OptionItem } from "@/lib/db/columns";
import { chipClasses } from "@/lib/colors";

// Read-only coloured label of a single-select option. The label and colour come from the current option, so rename/recolour shows everywhere (FR-3.3).
// Fixed 20px pill (h-5), so it is the same height in table cells and on the detail page. inline-block (not flex) so truncate shows an ellipsis;
// max-w-48 keeps a long label from widening a column or a form, the full label is in the title.
export function OptionChip({ option }: { option: Pick<OptionItem, "label" | "color"> }) {
  return <span title={option.label} className={`inline-block h-5 max-w-48 truncate rounded-full px-2 align-middle text-xs leading-5 font-medium ${chipClasses(option.color)}`}>{option.label}</span>;
}
