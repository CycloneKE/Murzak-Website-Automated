import React, { useEffect, useState } from "react";
import { Server } from "lucide-react";
import { SelectedServiceView } from "../../types";
import { fetchAllServiceActivity, ProvisioningActivityEntry } from "../../services/serviceActivity";
import { realStateFor, type RealState } from "./resourceState";
import { DataTable, Empty, Panel, StatusPill, type PillTone } from "./ui";

interface ResourceListProps {
  services: SelectedServiceView[];
  onSelect: (serviceId: string) => void;
  onAdd?: () => void;
  /** Panel heading; omit on a page that already has a title. */
  title?: string;
}

const TONE: Record<RealState["tone"], PillTone> = {
  green: "ok",
  blue: "progress",
  orange: "warn",
  red: "bad",
  slate: "idle",
};

/**
 * The list of a customer's services. Status comes from the service's real
 * Provisioning Job, never the Web Account's optimistic `status` field (set to
 * "Active" the instant payment clears, whether or not provisioning ever ran) —
 * so "I bought this" and "it's actually running" can't be mistaken for each
 * other.
 */
const ResourceList: React.FC<ResourceListProps> = ({ services, onSelect, onAdd, title }) => {
  const [jobsByService, setJobsByService] = useState<Record<string, ProvisioningActivityEntry>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchAllServiceActivity()
      .then((jobs) => {
        if (!cancelled) setJobsByService(jobs);
      })
      .catch(() => {
        if (!cancelled) setJobsByService({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [services.length]);

  const state = (svc: SelectedServiceView) => realStateFor(svc, jobsByService[svc.serviceId]);

  return (
    <Panel title={title} flush>
      <DataTable
        rows={services}
        rowKey={(s) => s.serviceId}
        rowLabel={(s) => `Open ${s.name}`}
        onRowClick={(s) => onSelect(s.serviceId)}
        empty={
          <Empty
            icon={<Server />}
            title="No services yet"
            description="Add a service to get started. It appears here as soon as you order it."
            actionLabel={onAdd ? "Add a service" : undefined}
            onAction={onAdd}
          />
        }
        columns={[
          { key: "name", header: "Name", primary: true, cell: (s) => <span title={s.name}>{s.name}</span> },
          {
            key: "type",
            header: "Type",
            cell: (s) => `${s.category || "Service"}${s.tier ? ` · ${s.tier}` : ""}`,
          },
          {
            key: "detail",
            header: "Address",
            cell: (s) => {
              const st = state(s);
              return loading ? "" : st.detail || "—";
            },
          },
          {
            key: "status",
            header: "Status",
            className: "w-44",
            cell: (s) => {
              const st = state(s);
              return <StatusPill tone={loading ? "idle" : TONE[st.tone]}>{loading ? "Checking…" : st.label}</StatusPill>;
            },
          },
        ]}
      />
    </Panel>
  );
};

export default ResourceList;
