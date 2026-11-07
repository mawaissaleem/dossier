"use client";

import { createContext, useContext, useEffect } from "react";

// The table only mounts the rows near the viewport. A row with an open editor must stay mounted (its edit state is local to the cell),
// so the cell registers its application id here while it is editing and the table keeps that row in the window.
export const RowPinContext = createContext<((applicationId: number) => () => void) | null>(null);

export function usePinRow(applicationId: number, active: boolean) {
  const pin = useContext(RowPinContext);
  useEffect(() => (active && pin ? pin(applicationId) : undefined), [pin, applicationId, active]);
}
