import React from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import ResourceList from "../../../components/portal/ResourceList";
import { PageHeader, PButton } from "../../../components/portal/ui";
import ServicePage from "./service/ServicePage";
import { usePortal } from "../PortalContext";
import { servicePath } from "../helpers";

/**
 * "Your services": the list at /portal/cloud, and one service's own page at
 * /portal/cloud/<id>[/<section>].
 */
const CloudTab: React.FC = () => {
  const { navigate, openAddonsModal, selectedServices } = usePortal();
  const { serviceId } = useParams();
  const location = useLocation();

  // Older links (emails, checkout, bookmarks) use /portal/cloud?service=<id>.
  // Send them to the service's page, keeping any other query (justProvisioned).
  if (!serviceId) {
    const sp = new URLSearchParams(location.search);
    const legacy = sp.get("service");
    if (legacy) {
      sp.delete("service");
      const rest = sp.toString();
      return <Navigate replace to={`${servicePath(legacy)}${rest ? `?${rest}` : ""}`} />;
    }
  }

  if (serviceId) return <ServicePage />;

  return (
    <div>
      <PageHeader
        title="Your services"
        description="Everything you run with us. A service starts once its invoice is paid."
        actions={
          <PButton variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => openAddonsModal("cloud")}>
            Add a service
          </PButton>
        }
      />
      <ResourceList
        services={selectedServices}
        onAdd={() => openAddonsModal("cloud")}
        onSelect={(id) => {
          const svc = selectedServices.find((s) => s.serviceId === id);
          if (svc?.status === "Awaiting Payment") {
            navigate("/portal/billing");
          } else {
            navigate(servicePath(id));
          }
        }}
      />
    </div>
  );
};

export default CloudTab;
