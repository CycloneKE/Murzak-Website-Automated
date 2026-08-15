// src/pages/Portal.tsx
//
// Entry point for the customer/staff portal. Everything that used to live in
// this file (3,195 lines: state, five screens and the chrome, all in one
// component) now sits under ./portal — the data layer in usePortalState,
// the chrome in PortalShell, and one file per screen in ./portal/tabs.
import React from "react";
import { PortalProvider } from "./portal/PortalContext";
import PortalShell from "./portal/PortalShell";
import { type PortalProps } from "./portal/types";

const Portal: React.FC<PortalProps> = (props) => (
  <PortalProvider {...props}>
    <PortalShell />
  </PortalProvider>
);

export default Portal;
