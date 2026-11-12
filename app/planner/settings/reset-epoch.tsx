"use client";

import { createContext, Fragment, useContext, useState } from "react";

// The settings forms keep what you typed in local state, so after a reset their props change but their fields would not. Everything wrapped in
// <ResetKeyed> remounts when the epoch bumps; the reset section itself sits outside it, so its dialog and status survive.
const Epoch = createContext<{ epoch: number; bump: () => void }>({ epoch: 0, bump: () => {} });

export function ResetEpoch({ children }: { children: React.ReactNode }) {
  const [epoch, setEpoch] = useState(0);
  return <Epoch value={{ epoch, bump: () => setEpoch((n) => n + 1) }}>{children}</Epoch>;
}

export const useResetEpoch = () => useContext(Epoch);

export function ResetKeyed({ children }: { children: React.ReactNode }) {
  return <Fragment key={useResetEpoch().epoch}>{children}</Fragment>;
}
