import React, { useEffect } from "react";
import {
  AlertTriangle, ExternalLink, FileText, Headphones, Lock, Maximize2, Play, RotateCw, SearchX, ShieldCheck, Square, X,
} from "lucide-react";
import DeveloperTerminalPanel from "../../../../components/portal/DeveloperTerminalPanel";
import ResourceAdminPanel from "../../../../components/portal/cloud/ResourceAdminPanel";
import ResourceAdminGate from "../../../../components/portal/cloud/ResourceAdminGate";
import EnvironmentPanel from "../../../../components/portal/cloud/EnvironmentPanel";
import RuntimeLogsPanel from "../../../../components/portal/cloud/RuntimeLogsPanel";
import HealthcheckPanel from "../../../../components/portal/cloud/HealthcheckPanel";
import DomainsPanel from "../../../../components/portal/cloud/DomainsPanel";
import BackupsPanel from "../../../../components/portal/cloud/BackupsPanel";
import AnalyticsPanel from "../../../../components/portal/cloud/AnalyticsPanel";
import DeploymentsPane from "../../../../components/portal/cloud/DeploymentsPane";
import StorageFileBrowser from "../../../../components/portal/cloud/StorageFileBrowser";
import MailboxManager from "../../../../components/portal/cloud/MailboxManager";
import DatabaseConnectionPanel from "../../../../components/portal/cloud/DatabaseConnectionPanel";
import PosLoginPanel from "../../../../components/portal/cloud/PosLoginPanel";
import WebsiteHostingDashboard from "../../../../components/portal/cloud/website-hosting/WebsiteHostingDashboard";
import ShopChecklist from "../../../../components/apps/ShopChecklist";
import {
  Banner, Empty, Field, PButton, Panel, SectionNav, StatusPill, inputClass, statusTone,
} from "../../../../components/portal/ui";
import { usePortal } from "../../PortalContext";
import { servicePath } from "../../helpers";
import { toUserMessage } from "../../../../services/errors";
import { sectionsFor, type SectionId } from "./sections";

// Per-resource value straight off the Provisioning Job record
// (backupStatus / edgeStatus). No fabricated timestamps or counts: a service
// with no off-site backup provider configured says so plainly.
const PROTECTION: Record<string, { text: string; tone: "ok" | "idle" | "bad" }> = {
  configured: { text: "Configured", tone: "ok" },
  skipped: { text: "Not configured yet", tone: "idle" },
  failed: { text: "Attention needed", tone: "bad" },
};
const protectionPill = (value?: string) => {
  const s = (value && PROTECTION[value]) || { text: "Not tracked yet", tone: "idle" as const };
  return <StatusPill tone={s.tone}>{s.text}</StatusPill>;
};

/** A label / value row inside a Panel. */
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-4 sm:px-5 py-3 border-b border-p-border last:border-b-0">
    <dt className="sm:w-40 shrink-0 text-[13px] text-p-muted">{label}</dt>
    <dd className="min-w-0 grow text-sm text-p-text">{children}</dd>
  </div>
);

/**
 * One service, on a page of its own. Everything you can do to the service
 * lives here, grouped by what you came to do — the section menu on the left
 * lists only what applies to this kind of service (see sectionsFor).
 */
const ServicePage: React.FC = () => {
  const {
    cloudAccessUrl, cloudJob, cloudSection, cloudServiceId, deployments,
    deploymentsAvailable, domainInput, domainResult, domainSubmitting, handleRedeploy,
    handleServiceHealthAction, navigate, onRequestDelete, onTabClick,
    pendingServiceAction, redeployNote, redeploying, resourceAdminActive, selectedServices,
    setActiveLogServiceId, setDeveloperUpsellSvc, setDomainInput,
    setIsContactOpen, setResourceAdminActive, setTopBar, setSideContext, submitDomainAttach,
    serviceActionNotice, setServiceActionNotice,
  } = usePortal();

  const svc = selectedServices.find((s) => s.serviceId === cloudServiceId);
  const isActive = svc?.status === "Active";
  const name = svc?.name || "Service";
  const status = svc?.status || "";
  const openUrl = isActive && cloudAccessUrl ? cloudAccessUrl : "";

  // Breadcrumb, status pill and the one primary action go in the top bar.
  useEffect(() => {
    if (!svc) {
      setTopBar({
        crumbs: [
          { label: "Home", to: "/portal/overview" },
          { label: "Your services", to: "/portal/cloud" },
          { label: "Not found" },
        ],
      });
    } else {
      setTopBar({
        crumbs: [
          { label: "Home", to: "/portal/overview" },
          { label: "Your services", to: "/portal/cloud" },
          { label: name },
        ],
        status: <StatusPill tone={statusTone(status)}>{status === "Awaiting Payment" ? "Awaiting payment" : status}</StatusPill>,
        actions: openUrl ? (
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-tap inline-flex items-center gap-2 rounded-md bg-p-accent hover:bg-p-accent-hover text-p-accent-fg px-3.5 text-sm font-medium"
          >
            Open <ExternalLink className="w-4 h-4" />
          </a>
        ) : undefined,
      });
    }
    return () => setTopBar(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc?.serviceId, name, status, openUrl]);

  const sections = svc ? sectionsFor({ service: svc, deployable: deploymentsAvailable }) : [];
  const active: SectionId = sections.some((s) => s.id === cloudSection) ? (cloudSection as SectionId) : "general";

  // On desktop the sidebar swaps to this service's sections, so the page needs
  // no second menu of its own. Re-registered only when what it shows changes.
  const sectionKey = sections.map((s) => s.id).join(",");
  useEffect(() => {
    if (!svc || !cloudServiceId || sections.length < 2) {
      setSideContext(null);
      return;
    }
    setSideContext({
      title: name,
      subtitle: [svc.category, svc.tier].filter(Boolean).join(" · "),
      backLabel: "Your services",
      onBack: () => navigate("/portal/cloud"),
      items: sections,
      activeId: active,
      onSelect: (id) => navigate(servicePath(cloudServiceId, id)),
    });
    return () => setSideContext(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc?.serviceId, name, sectionKey, active]);

  if (!cloudServiceId) return null;

  if (!svc) {
    return (
      <Panel>
        <Empty
          icon={<SearchX />}
          title="We couldn't find that service"
          description="It may have been removed, or the link is out of date."
          actionLabel="Back to your services"
          onAction={() => navigate("/portal/cloud")}
        />
      </Panel>
    );
  }

  const stopping = pendingServiceAction?.id === cloudServiceId && pendingServiceAction.action === "stop";
  const restarting = pendingServiceAction?.id === cloudServiceId && pendingServiceAction.action === "restart";
  const starting = pendingServiceAction?.id === cloudServiceId && pendingServiceAction.action === "start";
  const restartable = isActive && sections.some((x) => x.id === "advanced");

  return (
    <div className="flex flex-col gap-5">
      {sections.length > 1 && (
        <SectionNav
          stripOnly
          label={`${name} sections`}
          items={sections}
          active={active}
          onSelect={(id) => navigate(servicePath(cloudServiceId, id))}
        />
      )}

      <div className="min-w-0 grow space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-p-text truncate">{name}</h1>
          <p className="mt-1 text-[13px] text-p-muted">
            {svc.category || "Service"}{svc.tier ? ` · ${svc.tier}` : ""}
          </p>
        </div>

        {serviceActionNotice && (
          <div
            role="status"
            className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
              serviceActionNotice.type === "success" ? "border-p-success/40 bg-p-success-soft" : "border-p-danger/40 bg-p-danger-soft"
            }`}
          >
            <span>{serviceActionNotice.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setServiceActionNotice(null)} className="p-1 rounded-md text-p-muted hover:text-p-text">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {active === "general" && svc.serviceId === "biz-web-hosting" && <WebsiteHostingDashboard />}

        {active === "general" && svc.serviceId !== "biz-web-hosting" && (
          <>
            {!isActive && status === "Awaiting Payment" && (
              <Banner tone="warning" action={{ label: "Pay & activate", onClick: () => onTabClick("billing") }}>
                This service starts as soon as its invoice is paid.
              </Banner>
            )}

            {/* Honest provisioning states — a paid service must never look like
                an empty page. Each notice says what's happening and what (if
                anything) the customer should do. */}
            {cloudJob?.statusDetail === "waiting_on_repo" && (
              <Banner tone="warning" action={{ label: "Add repository", onClick: () => navigate("/portal/profile") }}>
                <span className="font-medium">Add your repository to start deployment.</span>{" "}
                We can't build your app until we have its Git repository. Add it under Settings → Project
                repository and our system will pick it up automatically.
              </Banner>
            )}
            {cloudJob?.statusDetail === "needs_attention" && (
              <Banner tone="danger" action={{ label: "View build log", onClick: () => setActiveLogServiceId(cloudServiceId) }}>
                <span className="font-medium">The last deployment didn't complete.</span>{" "}
                Our team has been notified and is on it.
                {cloudJob?.error && (
                  <span className="block mt-1 text-[13px] text-p-muted wrap-break-word">
                    {toUserMessage(cloudJob.error, "Our team is reviewing the deployment logs.")}
                  </span>
                )}
              </Banner>
            )}
            {(cloudJob?.status === "queued" || cloudJob?.status === "running") && (
              <Banner tone="info" action={{ label: "Watch live log", onClick: () => setActiveLogServiceId(cloudServiceId) }}>
                <span className="font-medium">{cloudJob.status === "running" ? "Deploying." : "Queued."}</span>{" "}
                {cloudJob.status === "running"
                  ? "Your app is being built and deployed. This usually takes a few minutes."
                  : "Your deployment is queued and will start shortly."}
              </Banner>
            )}
            {isActive && !cloudAccessUrl && cloudJob?.statusDetail === "url_pending" && (
              <Banner tone="info">
                <span className="font-medium">Web address pending.</span>{" "}
                Your app is deployed and we're assigning its web address. Check back shortly, or message
                support if this persists.
              </Banner>
            )}

            <Panel
              title="Details"
              flush
              actions={
                restartable && (
                  <>
                  <PButton
                    icon={<Play className="w-4 h-4" />}
                    loading={starting}
                    disabled={pendingServiceAction?.id === cloudServiceId}
                    onClick={() => handleServiceHealthAction("start", cloudServiceId)}
                  >
                    {starting ? "Starting…" : "Start"}
                  </PButton>
                  <PButton
                    icon={<RotateCw className="w-4 h-4" />}
                    loading={restarting}
                    disabled={pendingServiceAction?.id === cloudServiceId}
                    onClick={() => handleServiceHealthAction("restart", cloudServiceId)}
                  >
                    {restarting ? "Restarting…" : "Restart"}
                  </PButton>
                  </>
                )
              }
            >
              <dl>
                <Row label="Name">{name}</Row>
                <Row label="Type">{svc.category || "Service"}{svc.tier ? ` · ${svc.tier}` : ""}</Row>
                {openUrl && (
                  <Row label="Web address">
                    <a href={openUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-p-accent-text hover:underline">
                      <span className="truncate">{openUrl}</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    </a>
                  </Row>
                )}
                {cloudJob?.target && <Row label="Hosted on">Murzak Cloud · {cloudJob.target} · Managed from Nairobi</Row>}
                {isActive && cloudJob && (
                  <>
                    <Row label="Off-site backup">
                      <span className="inline-flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-p-muted" /> {protectionPill(cloudJob.backupStatus)}
                      </span>
                    </Row>
                    <Row label="Firewall">
                      <span className="inline-flex items-center gap-2">
                        <Lock className="w-4 h-4 text-p-muted" /> {protectionPill(cloudJob.edgeStatus)}
                      </span>
                    </Row>
                  </>
                )}
              </dl>
            </Panel>

            {isActive && cloudAccessUrl && cloudJob?.posLogin && (
              <>
                <PosLoginPanel posUrl={cloudAccessUrl} login={cloudJob.posLogin} />
                <ShopChecklist serviceId={cloudServiceId} />
              </>
            )}

            <Panel
              title={resourceAdminActive ? "You have advanced controls" : "We look after this for you"}
              actions={
                <>
                  {isActive && cloudJob && (
                    <PButton icon={<FileText className="w-4 h-4" />} onClick={() => setActiveLogServiceId(cloudServiceId)}>
                      Activity log
                    </PButton>
                  )}
                  <PButton icon={<Headphones className="w-4 h-4" />} onClick={() => setIsContactOpen(true)}>
                    Message support
                  </PButton>
                </>
              }
            >
              <p className="text-sm text-p-muted">
                {resourceAdminActive
                  ? "Our Nairobi team still runs, secures and backs up the platform underneath it, but the configuration you change under Advanced is yours. Need a hand? Message support any time."
                  : "This is a fully managed service. Our Nairobi team runs, secures and backs it up for you. There's no console to babysit. Need a change, a report or a hand? Message support and we'll take care of it."}
              </p>
            </Panel>
          </>
        )}

        {active === "files" && <StorageFileBrowser serviceId={cloudServiceId} isActive={isActive} />}
        {active === "mailboxes" && <MailboxManager serviceId={cloudServiceId} isActive={isActive} />}
        {active === "connection" && <DatabaseConnectionPanel serviceId={cloudServiceId} isActive={isActive} />}

        {active === "address" && <DomainsPanel serviceId={cloudServiceId} />}

        {active === "environment" && (
          <ResourceAdminGate
            serviceId={cloudServiceId}
            serviceName={name}
            isActive={isActive}
            capability="Environment variables"
            onRequestUpgrade={() => setDeveloperUpsellSvc(cloudServiceId)}
            onActiveChange={setResourceAdminActive}
          >
            <EnvironmentPanel serviceId={cloudServiceId} />
          </ResourceAdminGate>
        )}

        {active === "logs" && (
          <ResourceAdminGate
            serviceId={cloudServiceId}
            serviceName={name}
            isActive={isActive}
            capability="Runtime logs"
            onRequestUpgrade={() => setDeveloperUpsellSvc(cloudServiceId)}
          >
            <RuntimeLogsPanel serviceId={cloudServiceId} />
          </ResourceAdminGate>
        )}

        {active === "health" && (
          <ResourceAdminGate
            serviceId={cloudServiceId}
            serviceName={name}
            isActive={isActive}
            capability="Healthcheck settings"
            onRequestUpgrade={() => setDeveloperUpsellSvc(cloudServiceId)}
          >
            <HealthcheckPanel serviceId={cloudServiceId} />
          </ResourceAdminGate>
        )}

        {active === "analytics" && <AnalyticsPanel serviceId={cloudServiceId} />}

        {active === "terminal" && (
          <DeveloperTerminalPanel
            serviceId={cloudServiceId}
            isActive={isActive}
            onRequestUpgrade={() => setDeveloperUpsellSvc(cloudServiceId)}
          />
        )}

        {active === "backups" && <BackupsPanel serviceId={cloudServiceId} serviceName={name} />}

        {active === "updates" && (
          <DeploymentsPane
            serviceId={cloudServiceId}
            deployments={deployments}
            isActive={isActive}
            redeploying={redeploying}
            redeployNote={redeployNote}
            onRedeploy={handleRedeploy}
          />
        )}

        {active === "advanced" && (
          <>
            <ResourceAdminPanel serviceId={cloudServiceId} serviceName={name} />
            {svc.capacityClass === "scalable" && isActive && (
              <Panel
                title="Scaling"
                description="Set a fixed number of copies, or let it scale automatically with traffic."
                actions={
                  <PButton icon={<Maximize2 className="w-4 h-4" />} onClick={() => handleServiceHealthAction("scale", cloudServiceId)}>
                    Scaling settings
                  </PButton>
                }
              />
            )}
          </>
        )}

        {active === "danger" && (
          <Panel
            tone="danger"
            title="Danger zone"
            description="These act on this service immediately. There's no undo from here. Message support if you're not sure."
            flush
          >
            <ul className="divide-y divide-p-border">
              {isActive && (
                <li className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 sm:px-5 py-4">
                  <div className="grow">
                    <p className="text-sm font-medium text-p-text">Stop this service</p>
                    <p className="text-[13px] text-p-muted">Takes it offline until you start it again. Your data is kept.</p>
                  </div>
                  <PButton
                    variant="danger"
                    icon={<Square className="w-4 h-4" />}
                    loading={stopping}
                    disabled={pendingServiceAction?.id === cloudServiceId}
                    onClick={() => handleServiceHealthAction("stop", cloudServiceId)}
                  >
                    {stopping ? "Stopping…" : "Stop service"}
                  </PButton>
                </li>
              )}
              <li className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 sm:px-5 py-4">
                <div className="grow">
                  <p className="text-sm font-medium text-p-text">Delete this service</p>
                  <p className="text-[13px] text-p-muted">Removes the service and everything inside it. This cannot be undone.</p>
                </div>
                <PButton variant="danger" icon={<AlertTriangle className="w-4 h-4" />} onClick={() => onRequestDelete(svc, "overview")}>
                  Delete service
                </PButton>
              </li>
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
};

export default ServicePage;
