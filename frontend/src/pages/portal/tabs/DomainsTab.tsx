import React, { useState } from "react";
import { AlertCircle, CheckCircle2, Globe, Link2, Link2Off, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import AddDomainModal from "../../../components/portal/AddDomainModal";
import { Banner, Empty, PageHeader, Panel, PButton, StatusPill, inputClass, type PillTone } from "../../../components/portal/ui";
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

const STATUS_TONE: Record<CustomerDomain["status"], PillTone> = {
  active: "ok",
  pending: "progress",
  failed: "bad",
  expired: "warn",
  cancelled: "idle",
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
  pending: "Our team is setting this up. We'll email you when it's live.",
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
    <div>
      <PageHeader
        title="Domains"
        description="Every domain on your account, and what it points at."
        actions={
          <>
            <PButton
              icon={<RefreshCw className={`w-4 h-4 ${domainsLoading ? "animate-spin" : ""}`} />}
              onClick={refreshDomains}
              aria-label="Refresh domains"
            >
              Refresh
            </PButton>
            <PButton variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setIsAddDomainOpen(true)}>
              Add a domain
            </PButton>
          </>
        }
      />

      {domainNotice && (
        <Banner
          tone={domainNotice.type === "success" ? "success" : "danger"}
          icon={domainNotice.type === "success" ? <CheckCircle2 className="w-[18px] h-[18px]" /> : <AlertCircle className="w-[18px] h-[18px]" />}
          className="mb-4"
        >
          {domainNotice.text}
        </Banner>
      )}

      {domainsError && (
        <p role="alert" className="mb-4 flex items-center gap-2 text-[13px] text-p-danger">
          <AlertCircle className="w-4 h-4" /> {domainsError}
        </p>
      )}

      <Panel flush>
        {domainsLoading && domains.length === 0 ? (
          <p className="py-12 text-center text-[13px] text-p-muted">Loading your domains...</p>
        ) : domains.length === 0 ? (
          <Empty
            icon={<Globe />}
            title="No domains yet"
            description="Register a new domain, connect one you already own, or take a free Murzak subdomain. Any of them can point at any of your services."
            actionLabel="Add a domain"
            onAction={() => setIsAddDomainOpen(true)}
          />
        ) : (
          <ul className="divide-y divide-p-border">
            {domains.map((d) => {
              const busy = domainBusyId === d.id;
              const attachedTo = serviceLabel(d.attachedToService);
              const expiry = fmtDate(d.expiresOn);
              return (
                <li key={d.id} className="px-4 sm:px-5 py-4 flex flex-col lg:flex-row lg:items-center gap-3">
                  <div className="min-w-0 grow">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <p className="text-sm font-semibold text-p-text truncate" title={d.domainName}>{d.domainName}</p>
                      <StatusPill tone={STATUS_TONE[d.status]}>{STATUS_TEXT[d.status]}</StatusPill>
                      {d.sslStatus === "active" && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-p-success">
                          <ShieldCheck className="w-3.5 h-3.5" /> Secure (SSL)
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[13px] text-p-muted">
                      {KIND_LABEL[d.kind]}
                      {expiry ? ` · renews ${expiry}` : ""}
                    </p>
                    <p className="mt-1 text-[13px] text-p-muted">
                      {STATUS_HINT[d.status]}{" "}
                      {attachedTo ? (
                        <>Currently serving <span className="font-medium text-p-text">{attachedTo}</span>.</>
                      ) : (
                        "Not pointed at anything yet. It's yours to use whenever you want."
                      )}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {picking === d.id ? (
                      <>
                        <select
                          aria-label={`Service for ${d.domainName}`}
                          value={pickedService}
                          onChange={(e) => setPickedService(e.target.value)}
                          className={`${inputClass} !w-auto max-w-56`}
                        >
                          {attachable.length === 0 && <option value="">No active services</option>}
                          {attachable.map((s) => (
                            <option key={s.serviceId} value={s.serviceId}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <PButton variant="primary" loading={busy} disabled={!pickedService} onClick={() => confirmAttach(d)}>
                          {busy ? "Working..." : "Point it here"}
                        </PButton>
                        <PButton onClick={() => setPicking("")}>Cancel</PButton>
                      </>
                    ) : (
                      <>
                        <PButton
                          icon={<Link2 className="w-4 h-4" />}
                          disabled={busy || attachable.length === 0}
                          onClick={() => startPicking(d)}
                          title={attachable.length === 0 ? "You need an active service first" : undefined}
                        >
                          {attachedTo ? "Move" : "Point at a service"}
                        </PButton>
                        {d.attachedToService && (
                          <PButton icon={<Link2Off className="w-4 h-4" />} disabled={busy} onClick={() => detachCustomerDomain(d.id)}>
                            {busy ? "Working..." : "Detach"}
                          </PButton>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

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
