import React from "react";
import { Plus } from "lucide-react";
import ResourceList from "../../../components/portal/ResourceList";
import WebsiteHostingDashboard from "../../../components/portal/cloud/website-hosting/WebsiteHostingDashboard";
import ResourceDetail from "./ResourceDetail";
import { usePortal } from "../PortalContext";

const CloudTab: React.FC = () => {
  const { cloudServiceId, navigate, openAddonsModal, selectedServices } =
    usePortal();

  return (
    <div className="space-y-8 animate-fade-in max-w-6xl mx-auto">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tighter uppercase">
            {cloudServiceId === "biz-web-hosting" ? "Website Hosting" : "Resources"}
          </h2>
          <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-3">
            {cloudServiceId === "biz-web-hosting"
              ? "Manage your hosting service, domains, subdomains, files and requests"
              : "Systems become active after payment is settled"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {cloudServiceId && (
            <button
              onClick={() => navigate("/portal/cloud")}
              className="px-4 py-3 rounded-2xl border border-slate-200 dark:border-murzak-border bg-white dark:bg-black/5 text-slate-600 dark:text-slate-200 font-black text-micro uppercase"
            >
              Back to Resources
            </button>
          )}

          {!cloudServiceId && (
            <button
              onClick={() => openAddonsModal("cloud")}
              className="px-5 py-3 rounded-2xl bg-murzak-accent text-murzak-ink font-black text-micro uppercase hover:scale-[1.02] transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add Services
            </button>
          )}
        </div>
      </div>

      {!cloudServiceId && (
        <div className="space-y-8">
          <ResourceList
            services={selectedServices}
            onSelect={(id) => {
              const svc = selectedServices.find((s) => s.serviceId === id);
              if (svc?.status === "Awaiting Payment") {
                navigate("/portal/billing");
              } else {
                navigate(`/portal/cloud?service=${encodeURIComponent(id)}`);
              }
            }}
          />
        </div>
      )}

      {cloudServiceId === "biz-web-hosting" && <WebsiteHostingDashboard />}

      {cloudServiceId && cloudServiceId !== "biz-web-hosting" && <ResourceDetail />}
    </div>
  );
};

export default CloudTab;
