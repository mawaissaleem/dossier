import { describe, expect, it } from "vitest";
import { COLUMN_TYPES } from "@/lib/db/schema";
import { COLUMN_TYPE_LABELS, columnTypeOptions } from "@/lib/column-types";

describe("column type labels", () => {
  it("labels every column type, in COLUMN_TYPES order", () => {
    expect(columnTypeOptions.map((o) => o.type)).toEqual([...COLUMN_TYPES]);
    for (const t of COLUMN_TYPES) expect(COLUMN_TYPE_LABELS[t]).toMatch(/\S/);
  });
});
