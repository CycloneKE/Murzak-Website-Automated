import React, { useEffect, useState } from "react";
import { Server } from "lucide-react";
import { SelectedServiceView } from "../../types";
import { fetchAllServiceActivity, ProvisioningActivityEntry } from "../../services/serviceActivity";
import { RealStateBadge, realStateFor } from "./resourceState";

interface ResourceListProps {
  services: SelectedServiceView[];
  onSelect: (serviceId: string) => void;
}

/**
 * The Cloud tab's resource list — replaces the old react-flow topology map,
 * which rendered its green "healthy" pulse straight off the Web Account's
 * optimistic `status` field (set to "Active" the instant payment clears,
 * independent of whether provisioning ever ran). Two facts per card, side by
 * side, so "I bought this" and "it's actually running" can never be mistaken
 * for each other.
 */
const ResourceList: React.FC<ResourceListProps> = ({ services, onSelect }) => {
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

  if (services.length === 0) {
    return (
      <div className="rounded-[2rem] border border-slate-200 dark:border-murzak-border bg-white/80 dark:bg-white/5 backdrop-blur-xl p-10 text-center">
        <Server className="w-8 h-8 text-slate-400 mx-auto mb-3" />
        <p className="text-[13px] font-bold text-slate-600 dark:text-slate-400">
          No resources yet — add a service to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {services.map((svc) => {
        const job = jobsByService[svc.serviceId];
        const state = realStateFor(svc, job);
        return (
          <button
            key={svc.serviceId}
            type="button"
            onClick={() => onSelect(svc.serviceId)}
            className="text-left rounded-2xl border border-slate-200 dark:border-murzak-border bg-white/80 dark:bg-white/5 backdrop-blur-xl p-5 hover:border-murzak-accent/40 hover:shadow-lg transition-all"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 truncate">
                  {svc.category || "Service"}{svc.tier ? ` • ${svc.tier}` : ""}
                </p>
                <p className="text-[15px] font-black text-murzak-ink dark:text-slate-100 mt-0.5 truncate">
                  {svc.name}
                </p>
              </div>
              <div className="p-2 rounded-xl bg-murzak-accent/10 text-murzak-accent shrink-0">
                <Server className="w-4 h-4" />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10">
                Bought
              </span>
              <RealStateBadge svc={svc} job={job} loading={loading} />
            </div>

            {!loading && state.detail && (
              <p className="mt-2 text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                {state.detail}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default ResourceList;
