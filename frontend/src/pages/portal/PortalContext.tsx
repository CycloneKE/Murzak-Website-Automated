import React, { createContext, useContext } from "react";
import { usePortalState, type PortalValue } from "./usePortalState";
import { type PortalProps } from "./types";

/**
 * The portal's shared state. Null outside a provider so usePortal() can fail
 * loudly at the point of misuse instead of handing back undefined fields that
 * only blow up deep inside a tab's JSX.
 */
const PortalContext = createContext<PortalValue | null>(null);

export const PortalProvider: React.FC<PortalProps & { children: React.ReactNode }> = ({
  children,
  user,
  onLogout,
  onNavigate,
  onUserUpdate,
}) => {
  const value = usePortalState({ user, onLogout, onNavigate, onUserUpdate });
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
};

export function usePortal(): PortalValue {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error("usePortal must be used inside <PortalProvider>.");
  return ctx;
}

export type { PortalValue };
