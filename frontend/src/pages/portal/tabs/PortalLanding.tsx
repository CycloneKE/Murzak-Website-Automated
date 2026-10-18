import React from "react";
import { Navigate } from "react-router-dom";
import { usePortal } from "../PortalContext";

/**
 * Where /portal lands. A customer with one resource goes straight to that
 * resource's page; with several they get the resource list; with none they
 * get the Overview (onboarding). Domains are skipped — they have their own
 * tab and no resource page to land on.
 */
const PortalLanding: React.FC = () => {
  const { selectedServices } = usePortal();
  const resources = selectedServices.filter((s) => s.category !== "Domain Registration");

  if (resources.length === 0) return <Navigate to="overview" replace />;
  if (resources.length > 1) return <Navigate to="cloud" replace />;

  const only = resources[0];
  if (only.status === "Awaiting Payment") return <Navigate to="billing" replace />;
  return <Navigate to={`cloud?service=${encodeURIComponent(only.serviceId)}`} replace />;
};

export default PortalLanding;
