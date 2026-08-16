import React, { useState } from "react";
import { AlertCircle, CheckCircle2, Globe, Link2, Link2Off, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import AddDomainModal from "../../../components/portal/AddDomainModal";
import EmptyState from "../../../components/portal/EmptyState";
import { usePortal } from "../PortalContext";
import { type CustomerDomain } from "../../../types/hosting";

/**
 * The customer's domains — everything the account owns, whatever it currently
 * points at (including nothing).
 *
 * The old model had no such page and could not have had one: a domain existed
 * only as a request attached to one hosting service, chosen at checkout. This
 * is where "I own this name, and I decide what it serves" lives.
 */

const KIND_LABEL: Record<CustomerDomain["kind"], string> = {
  registered: "Registered for you",
  external: "Your own domain",
  murzak_subdomain: "Free subdomain",
};

const STATUS_TONE: Record<CustomerDomain["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/20",
  pending: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/20",
  failed: "bg-red-500/15 text-red-500 dark:text-red-400 border-red-500/20",
  expired: "bg-orange-500/15 text-orange-600 dark:text-orange-300 border-orange-500/20",
  cancelled: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-murzak-border",
};

/** Plain-language status, so a customer isn't reading our internal vocabulary. */
const STATUS_TEXT: Record<CustomerDomain["status"], string> = {
  active: "Live",
  pending: "Being set up",
  failed: "Needs attention",
  expired: "Expired",
  cancelled: "Cancelled",
};

const STATUS_HINT: Record<CustomerDomain["status"], string> = {
  active: "Resolving to your service.",
  pending: "Our team is setting this up — we'll email you when it's live.",
  failed: "Something went wrong. Message support and we'll sort it out.",
  expired: "This domain has lapsed. Contact us to renew it.",
  cancelled: "No longer active.",
};

function fmtDate(v?: string | null) {
  if (!v) return null;
  const d = new Date(String(v).includes("T") ? v : String(v).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

const DomainsTab: React.FC = () => {
  const {
    attachDomain,
    connectExternalDomain,
    detachCustomerDomain,
    domainBusyId,
    domainNotice,
    domains,
    domainsError,
    domainsLoading,
    refreshDomains,
    requestFreeSubdomain,
    requestNewDomain,
    selectedServices,
  } = usePortal();

  // Which domain's "point at…" picker is open, and what it's set to.
  const [picking, setPicking] = useState<string>("");
  const [pickedService, setPickedService] = useState<string>("");
  const [isAddDomainOpen, setIsAddDomainOpen] = useState(false);

  // You can only point a domain at something that's actually running. The
  // server enforces this too; hiding the rest just avoids offering a choice
  // that would be refused.
  const attachable = selectedServices.filter((s) => s.status === "Active");

  const serviceLabel = (serviceId: string | null) => {
    if (!serviceId) return null;
    return selectedServices.find((s) => s.serviceId === serviceId)?.name || serviceId;
  };

  const startPicking = (d: CustomerDomain) => {
    setPicking(d.id);
    setPickedService(attachable.find((s) => s.serviceId !== d.attachedToService)?.serviceId || "");
  };

  const confirmAttach = async (d: CustomerDomain) => {
    if (!pickedService) return;
    await attachDomain(d.id, pickedService);
    setPicking("");
  };

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tighter uppercase text-murzak-ink dark:text-slate-100">
            Domains
          </h2>
          <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-2">
            Every domain on your account, and what it points at.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshDomains}
            className="p-3 rounded-2xl hover:bg-murzak-accent/10 text-slate-500 hover:text-murzak-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-murzak-accent"
            title="Refresh"
            aria-label="Refresh domains"
          >
            <RefreshCw className={`w-[18px] h-[18px] ${domainsLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setIsAddDomainOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-murzak-accent text-murzak-ink text-micro font-black uppercase shadow-lg active:scale-95 transition-transform"
          >
            <Plus className="w-4 h-4" /> Add a domain
          </button>
        </div>
      </div>

      {domainNotice && (
        <div
          className={`mb-6 flex items-start gap-3 rounded-3xl border p-5 ${
            domainNotice.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10"
              : "border-red-500/30 bg-red-500/10"
          }`}
        >
          {domainNotice.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          )}
          <p className="text-sm font-bold text-murzak-ink dark:text-slate-100">{domainNotice.text}</p>
        </div>
      )}

      {domainsError && (
        <div className="mb-6 flex items-center gap-2 text-micro font-black uppercase text-red-500">
          <AlertCircle className="w-4 h-4" /> {domainsError}
        </div>
      )}

      {domainsLoading && domains.length === 0 ? (
        <div className="py-16 text-center text-micro font-black uppercase text-slate-600 dark:text-slate-400">
          Loading your domains...
        </div>
      ) : domains.length === 0 ? (
        <EmptyState
          icon={<Globe className="w-6 h-6" />}
          title="No domains yet"
          description="Register a new domain, connect one you already own, or take a free murzaktech.com address. Any of them can point at any of your services."
          actionLabel="Add a domain"
          onAction={() => setIsAddDomainOpen(true)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {domains.map((d) => {
            const busy = domainBusyId === d.id;
            const attachedTo = serviceLabel(d.attachedToService);
            const expiry = fmtDate(d.expiresOn);
            return (
              <div
                key={d.id}
                className="bg-white/80 dark:bg-white/60 backdrop-blur-md border border-slate-100 dark:border-murzak-border/50 rounded-[1.75rem] p-5 sm:p-6 shadow-lg"
              >
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  <div className="min-w-0 flex-grow">
                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="text-base font-black text-murzak-ink dark:text-slate-100 truncate">
                        {d.domainName}
                      </p>
                      <span className={`inline-flex items-center px-3 py-1 rounded-full border text-micro font-black uppercase ${STATUS_TONE[d.status]}`}>
                        {STATUS_TEXT[d.status]}
                      </span>
                      {d.sslStatus === "active" && (
                        <span className="inline-flex items-center gap-1 text-micro font-black uppercase text-emerald-600 dark:text-emerald-300">
                          <ShieldCheck className="w-3.5 h-3.5" /> SSL
                        </span>
                      )}
                    </div>
                    <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-2">
                      {KIND_LABEL[d.kind]}
                      {expiry ? ` • renews ${expiry}` : ""}
                    </p>
                    <p className="text-[12px] font-medium text-slate-500 dark:text-slate-500 mt-1.5 leading-relaxed">
                      {STATUS_HINT[d.status]}{" "}
                      {attachedTo ? (
                        <>Currently serving <span className="font-bold text-murzak-ink dark:text-slate-200">{attachedTo}</span>.</>
                      ) : (
                        "Not pointed at anything yet — it's yours to use whenever you want."
                      )}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {picking === d.id ? (
                      <>
                        <select
                          value={pickedService}
                          onChange={(e) => setPickedService(e.target.value)}
                          className="h-10 px-3 rounded-xl bg-slate-50 dark:bg-black/5 border border-slate-200 dark:border-murzak-border text-micro font-black uppercase text-murzak-ink dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-murzak-accent"
                        >
                          {attachable.length === 0 && <option value="">No active services</option>}
                          {attachable.map((s) => (
                            <option key={s.serviceId} value={s.serviceId}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={busy || !pickedService}
                          onClick={() => confirmAttach(d)}
                          className="h-10 px-4 rounded-xl bg-murzak-accent text-murzak-ink text-micro font-black uppercase disabled:opacity-50"
                        >
                          {busy ? "Working..." : "Point it here"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPicking("")}
                          className="h-10 px-4 rounded-xl border border-slate-200 dark:border-murzak-border text-micro font-black uppercase text-slate-500"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busy || attachable.length === 0}
                          onClick={() => startPicking(d)}
                          title={attachable.length === 0 ? "You need an active service first" : undefined}
                          className="h-10 px-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-murzak-border text-micro font-black uppercase text-slate-600 dark:text-slate-300 hover:border-murzak-accent/40 hover:text-murzak-accent transition disabled:opacity-50"
                        >
                          <Link2 className="w-4 h-4" /> {attachedTo ? "Move" : "Point at a service"}
                        </button>
                        {d.attachedToService && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => detachCustomerDomain(d.id)}
                            className="h-10 px-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-murzak-border text-micro font-black uppercase text-slate-600 dark:text-slate-300 hover:border-red-500/40 hover:text-red-500 transition disabled:opacity-50"
                          >
                            <Link2Off className="w-4 h-4" /> {busy ? "Working..." : "Detach"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AddDomainModal
        isOpen={isAddDomainOpen}
        onClose={() => setIsAddDomainOpen(false)}
        onRequestNewDomain={requestNewDomain}
        onConnectExternalDomain={connectExternalDomain}
        onRequestFreeSubdomain={requestFreeSubdomain}
      />
    </div>
  );
};

export default DomainsTab;
