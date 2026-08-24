import React, { useEffect, useState } from "react";
import { ArrowRight, Plus, Square, Trash2 } from "lucide-react";
import EmptyState from "../../../components/portal/EmptyState";
import { usePortal } from "../PortalContext";
import { type SelectedServiceView } from "../../../types";
import { fetchAllServiceActivity, ProvisioningActivityEntry } from "../../../services/serviceActivity";
import { RealStateBadge } from "../../../components/portal/resourceState";

/**
 * A resource-type section: the same services the Resources tab lists, narrowed
 * to one kind so an account with several databases can find them without
 * scanning a mixed list.
 *
 * Shared by Databases and Storage rather than copied, because the only real
 * difference between them is which services they show and what to say when
 * there are none.
 */

const STATUS_TONE: Record<string, string> = {
  Active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/20",
  "Setting up": "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/20",
  "Awaiting Payment": "bg-orange-500/15 text-orange-600 dark:text-orange-300 border-orange-500/20",
};

type Props = {
  title: string;
  subtitle: string;
  services: SelectedServiceView[];
  icon: React.ReactNode;
  emptyTitle: string;
  emptyDescription: string;
};

const ResourceListTab: React.FC<Props> = ({
  title,
  subtitle,
  services,
  icon,
  emptyTitle,
  emptyDescription,
}) => {
  const { navigate, openAddonsModal, handleServiceHealthAction, onRequestDelete, pendingServiceAction } = usePortal();

  const [jobsByService, setJobsByService] = useState<Record<string, ProvisioningActivityEntry>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetchAllServiceActivity()
      .then((jobs) => { if (!cancelled) setJobsByService(jobs); })
      .catch(() => { if (!cancelled) setJobsByService({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [services.length]);

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tighter uppercase text-murzak-ink dark:text-slate-100">
            {title}
          </h2>
          <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-2">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => openAddonsModal("cloud")}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-murzak-accent text-murzak-ink text-micro font-black uppercase shadow-lg active:scale-95 transition-transform self-start"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      {services.length === 0 ? (
        <EmptyState
          icon={icon}
          title={emptyTitle}
          description={emptyDescription}
          actionLabel="Browse what you can add"
          onAction={() => openAddonsModal("cloud")}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {services.map((s) => {
            const isPendingStop = pendingServiceAction?.id === s.serviceId && pendingServiceAction.action === "stop";
            return (
            <div
              key={s.serviceId}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/portal/cloud?service=${encodeURIComponent(s.serviceId)}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(`/portal/cloud?service=${encodeURIComponent(s.serviceId)}`);
                }
              }}
              className="text-left bg-white/80 dark:bg-white/60 backdrop-blur-md border border-slate-100 dark:border-murzak-border/50 rounded-[1.75rem] p-6 shadow-lg hover:border-murzak-accent/40 transition group cursor-pointer"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-base font-black text-murzak-ink dark:text-slate-100 truncate">{s.name}</p>
                  <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-1.5">
                    {s.tier || "—"}
                    {s.isAddon ? " • Add-on" : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 inline-flex items-center px-3 py-1 rounded-full border text-micro font-black uppercase ${
                    STATUS_TONE[s.status] || STATUS_TONE["Awaiting Payment"]
                  }`}
                >
                  {s.status}
                </span>
              </div>
              <div className="mt-3">
                <RealStateBadge svc={s} job={jobsByService[s.serviceId]} loading={loading} />
              </div>
              <div className="mt-5 flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-micro font-black uppercase text-murzak-accent">
                  Manage <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </span>
                {/* Quick actions — same handlers ResourceDetail's Danger Zone
                    already calls, surfaced here so stopping or deleting a
                    resource doesn't require navigating in twice first. */}
                <div
                  className="flex items-center gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {s.status === "Active" && (
                    <button
                      type="button"
                      title="Stop service"
                      disabled={isPendingStop}
                      onClick={() => handleServiceHealthAction("stop", s.serviceId)}
                      className="p-2 rounded-xl border border-orange-500/30 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 transition disabled:opacity-50"
                    >
                      <Square className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Delete service"
                    onClick={() => onRequestDelete(s, "overview")}
                    className="p-2 rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ResourceListTab;
