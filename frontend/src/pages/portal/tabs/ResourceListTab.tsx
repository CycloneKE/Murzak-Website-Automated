import React from "react";
import { Plus } from "lucide-react";
import ResourceList from "../../../components/portal/ResourceList";
import { Empty, PageHeader, Panel, PButton } from "../../../components/portal/ui";
import { usePortal } from "../PortalContext";
import { servicePath } from "../helpers";
import { type SelectedServiceView } from "../../../types";

/**
 * One kind of service on its own page: the same rows "Your services" lists,
 * narrowed so an account with several databases can find them without
 * scanning a mixed list.
 *
 * Shared by Databases and Storage rather than copied, because the only real
 * difference between them is which services they show and what to say when
 * there are none. Stop and delete live on each service's own page (Danger
 * zone), not on the row.
 */
type Props = {
  title: string;
  subtitle: string;
  services: SelectedServiceView[];
  icon: React.ReactNode;
  emptyTitle: string;
  emptyDescription: string;
};

const ResourceListTab: React.FC<Props> = ({ title, subtitle, services, icon, emptyTitle, emptyDescription }) => {
  const { navigate, openAddonsModal } = usePortal();

  return (
    <div>
      <PageHeader
        title={title}
        description={subtitle}
        actions={
          <PButton variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => openAddonsModal("cloud")}>
            Add
          </PButton>
        }
      />
      {services.length === 0 ? (
        <Panel>
          <Empty
            icon={icon}
            title={emptyTitle}
            description={emptyDescription}
            actionLabel="Browse what you can add"
            onAction={() => openAddonsModal("cloud")}
          />
        </Panel>
      ) : (
        <ResourceList
          services={services}
          onSelect={(id) => {
            const svc = services.find((s) => s.serviceId === id);
            navigate(svc?.status === "Awaiting Payment" ? "/portal/billing" : servicePath(id));
          }}
        />
      )}
    </div>
  );
};

export default ResourceListTab;
