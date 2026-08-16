import React, { useState } from "react";
import { ArrowRight, ExternalLink, Headphones, Server, Shield } from "lucide-react";
import DeveloperTerminalPanel from "../../../components/portal/DeveloperTerminalPanel";
import ResourceAdminPanel from "../../../components/portal/cloud/ResourceAdminPanel";
import StorageFileBrowser from "../../../components/portal/cloud/StorageFileBrowser";
import { usePortal } from "../PortalContext";

/**
 * One resource, with its own tabs.
 *
 * This content all existed — as a single long scroll inside the Resources tab,
 * where the deployment history, the env-var panel and the domain form were
 * stacked below the status cards and you scrolled past everything to reach
 * anything. Same blocks, grouped by what you came to do:
 *
 *   Overview     is it up, where is it, what is it doing
 *   Deployments  build history and logs (git-sourced apps only)
 *   Settings     env vars, developer access, custom domain
 *
 * Website Hosting keeps its own dedicated dashboard and never reaches here.
 */

type Pane = "overview" | "deployments" | "settings";

const ResourceDetail: React.FC = () => {
  const {
    cloudAccessUrl,
    cloudJob,
    cloudServiceId,
    deployLogView,
    deployments,
    deploymentsAvailable,
    domainInput,
    domainResult,
    domainSubmitting,
    handleRedeploy,
    navigate,
    onTabClick,
    openDeployLog,
    redeployNote,
    redeploying,
    resourceAdminActive,
    selectedServices,
    setActiveLogServiceId,
    setDeployLogView,
    setDeveloperUpsellSvc,
    setDomainInput,
    setIsContactOpen,
    setResourceAdminActive,
    submitDomainAttach,
  } = usePortal();

  const [pane, setPane] = useState<Pane>("overview");

  if (!cloudServiceId) return null;
  const svc = selectedServices.find((s) => s.serviceId === cloudServiceId);
  const isActive = svc?.status === "Active";

  const panes: { id: Pane; label: string }[] = [
    { id: "overview", label: "Overview" },
    // Only git-sourced apps have build history; hiding it beats an empty tab.
    ...(deploymentsAvailable ? [{ id: "deployments" as Pane, label: "Deployments" }] : []),
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="rounded-[2.25rem] border border-slate-200 dark:border-murzak-border bg-white/80 dark:bg-white/5 backdrop-blur-xl p-7 sm:p-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="p-3.5 rounded-2xl bg-murzak-accent/10 text-murzak-accent"><Server className="w-6 h-6" /></div>
                <div>
                  <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">
                    {svc?.category || "Service"}{svc?.tier ? ` • ${svc.tier}` : ""}
                  </p>
                  <h3 className="text-xl sm:text-2xl font-black text-murzak-ink dark:text-slate-100 mt-1">
                    {svc?.name || "Your service"}
                  </h3>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-micro font-black uppercase border ${
                isActive
                  ? "bg-green-500/10 text-green-500 border-green-500/20"
                  : "bg-orange-500/10 text-orange-500 border-orange-500/20"
              }`}>
                {isActive ? "Active" : "Awaiting payment"}
              </span>
            </div>

      <div className="mt-7 flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-murzak-border pb-4">
        {panes.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPane(p.id)}
            className={`px-4 py-2 rounded-xl text-micro font-black uppercase transition ${
              pane === p.id
                ? "bg-murzak-accent text-murzak-ink shadow-md"
                : "text-slate-500 hover:text-murzak-accent hover:bg-murzak-accent/10"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {pane === "overview" && (
        <>
            <div className="mt-7 rounded-2xl border border-slate-100 dark:border-murzak-border bg-slate-50/70 dark:bg-white/[0.03] p-5 flex items-start gap-3">
              <Shield className="w-5 h-5 text-murzak-accent shrink-0 mt-0.5" />
              <p className="text-[13px] font-medium text-slate-600 dark:text-slate-400 leading-relaxed">
                {resourceAdminActive ? (
                  <>
                    You have <span className="font-black text-murzak-ink dark:text-slate-100">advanced controls</span> on this
                    service — our Nairobi team still runs, secures and backs up the platform underneath it, but the
                    configuration you change below is yours. Need a hand? Message support any time.
                  </>
                ) : (
                  <>
                    This is a fully <span className="font-black text-murzak-ink dark:text-slate-100">managed</span> service — our Nairobi team
                    runs, secures and backs it up for you. There’s no console to babysit. Need a change, a report or a hand?
                    Message support and we’ll take care of it.
                  </>
                )}
              </p>
            </div>

            {isActive && cloudAccessUrl && (
              <a
                href={cloudAccessUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-murzak-accent/20 bg-murzak-accent/5 p-5 hover:bg-murzak-accent/10 transition-all group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2.5 rounded-xl bg-murzak-accent/10 text-murzak-accent shrink-0"><ExternalLink className="w-4 h-4" /></div>
                  <div className="min-w-0">
                    <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Live</p>
                    <p className="text-[13px] font-black text-murzak-ink dark:text-slate-100 truncate">{cloudAccessUrl}</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-murzak-accent shrink-0 group-hover:translate-x-1 transition-transform" />
              </a>
            )}

            {/* Honest provisioning states — a paid service must never look like
                an empty dashboard. Each card says what's happening and what
                (if anything) the customer should do. */}
            {cloudJob?.statusDetail === "waiting_on_repo" && (
              <div className="mt-4 rounded-2xl border border-orange-500/20 bg-orange-500/5 p-5">
                <p className="text-micro font-black uppercase text-orange-500 mb-1">Action needed</p>
                <p className="text-[13px] font-bold text-murzak-ink dark:text-slate-100">
                  Add your repository to start deployment.
                </p>
                <p className="text-[12px] font-medium text-slate-500 mt-1 leading-relaxed">
                  We can't build your app until we have its Git repository. Add it under{" "}
                  <button type="button" onClick={() => navigate("/portal/profile")} className="font-black text-murzak-accent underline underline-offset-2">
                    My Account → Project repository
                  </button>{" "}
                  and our system will pick it up automatically.
                </p>
              </div>
            )}
            {cloudJob?.statusDetail === "needs_attention" && (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
                <p className="text-micro font-black uppercase text-red-500 mb-1">Deployment issue</p>
                <p className="text-[13px] font-bold text-murzak-ink dark:text-slate-100">
                  The last deployment didn't complete — our team has been notified and is on it.
                </p>
                {cloudJob?.error && (
                  <p className="text-label font-mono text-slate-600 dark:text-slate-400 mt-2 break-words">{cloudJob.error}</p>
                )}
                <button
                  type="button"
                  onClick={() => setActiveLogServiceId(cloudServiceId)}
                  className="mt-3 text-label font-black uppercase tracking-widest text-murzak-accent"
                >
                  View build log →
                </button>
              </div>
            )}
            {(cloudJob?.status === "queued" || cloudJob?.status === "running") && (
              <div className="mt-4 rounded-2xl border border-murzak-accent/20 bg-murzak-accent/5 p-5 flex items-start gap-3">
                <div className="w-4 h-4 mt-0.5 rounded-full border-2 border-murzak-accent border-t-transparent animate-spin shrink-0" />
                <div>
                  <p className="text-micro font-black uppercase text-murzak-accent mb-1">
                    {cloudJob.status === "running" ? "Deploying" : "Queued"}
                  </p>
                  <p className="text-[12px] font-medium text-slate-500 leading-relaxed">
                    {cloudJob.status === "running"
                      ? "Your app is being built and deployed. This usually takes a few minutes."
                      : "Your deployment is queued and will start shortly."}
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveLogServiceId(cloudServiceId)}
                    className="mt-2 text-label font-black uppercase tracking-widest text-murzak-accent"
                  >
                    Watch live log →
                  </button>
                </div>
              </div>
            )}
            {isActive && !cloudAccessUrl && cloudJob?.statusDetail === "url_pending" && (
              <div className="mt-4 rounded-2xl border border-slate-200 dark:border-murzak-border bg-slate-50/70 dark:bg-white/[0.03] p-5">
                <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mb-1">URL pending</p>
                <p className="text-[12px] font-medium text-slate-500 leading-relaxed">
                  Your app is deployed and we're assigning its web address — check back shortly, or
                  message support if this persists.
                </p>
              </div>
            )}

            {cloudJob?.target && (
              <p className="mt-4 text-micro font-bold uppercase text-slate-600 dark:text-slate-400">
                Hosted on Murzak Cloud · {cloudJob.target} · Managed from Nairobi
              </p>
            )}

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setIsContactOpen(true)}
                className="px-6 py-3.5 rounded-2xl bg-murzak-accent text-murzak-ink font-black text-micro uppercase hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
              >
                <Headphones className="w-4 h-4" /> Message support
              </button>
              {!isActive && (
                <button
                  onClick={() => onTabClick("billing")}
                  className="px-6 py-3.5 rounded-2xl border border-slate-200 dark:border-white/15 text-murzak-ink dark:text-slate-100 font-black text-micro uppercase hover:bg-slate-100 dark:hover:bg-black/5 transition-all"
                >
                  Pay & activate
                </button>
              )}
            </div>
        </>
      )}

      {pane === "deployments" && (
        <>
            {/* Deployment history — git-sourced apps only (hidden otherwise). */}
            {deploymentsAvailable && (
              <div className="mt-4 rounded-2xl border border-slate-100 dark:border-murzak-border bg-slate-50/70 dark:bg-white/[0.03] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div>
                    <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Deployments</p>
                    <p className="text-label font-medium text-slate-600 dark:text-slate-400 mt-0.5">
                      Each deployment rebuilds your app from the latest commit on your branch.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRedeploy}
                    disabled={redeploying || !isActive}
                    className="px-4 py-2 rounded-xl bg-murzak-accent text-murzak-ink text-label font-black uppercase tracking-widest disabled:opacity-50 hover:scale-[1.02] transition-transform"
                  >
                    {redeploying ? "Starting…" : "Redeploy"}
                  </button>
                </div>
                {redeployNote && (
                  <p className="mb-3 text-label font-bold text-murzak-accent">{redeployNote}</p>
                )}
                {deployments.length === 0 ? (
                  <p className="text-[12px] font-medium text-slate-500">No deployments recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {deployments.slice(0, 8).map((d) => (
                      <div
                        key={d.uuid}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 dark:border-murzak-border bg-white/60 dark:bg-black/5 px-4 py-2.5"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`shrink-0 w-2 h-2 rounded-full ${
                              d.result === "success"
                                ? "bg-murzak-success"
                                : d.result === "failure"
                                ? "bg-red-500"
                                : "bg-orange-400 animate-pulse"
                            }`}
                          />
                          <div className="min-w-0">
                            <p className="text-label font-black text-murzak-ink dark:text-slate-100 truncate">
                              {d.commit ? `${d.commit}` : d.uuid.slice(0, 8)}
                              <span className="ml-2 font-bold text-slate-500 normal-case">
                                {d.status || "unknown"}
                              </span>
                            </p>
                            {(d.createdAt || d.commitMessage) && (
                              <p className="text-micro font-medium text-slate-600 dark:text-slate-400 truncate">
                                {[d.createdAt, d.commitMessage].filter(Boolean).join(" · ")}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => openDeployLog(d.uuid)}
                          className="text-micro font-black uppercase text-murzak-accent shrink-0"
                        >
                          Log
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
        </>
      )}

      {pane === "settings" && (
        <>
            {svc?.category === "Storage" ? (
              <StorageFileBrowser serviceId={cloudServiceId} isActive={isActive} />
            ) : (
              <>
                <ResourceAdminPanel
                  serviceId={cloudServiceId}
                  serviceName={svc?.name || cloudServiceId}
                  isActive={isActive}
                  onRequestUpgrade={() => setDeveloperUpsellSvc(cloudServiceId)}
                  onAdminActiveChange={setResourceAdminActive}
                />

                <DeveloperTerminalPanel
                  serviceId={cloudServiceId}
                  isActive={isActive}
                  onRequestUpgrade={() => setDeveloperUpsellSvc(cloudServiceId)}
                />

                {isActive && (
                  <div className="mt-4 rounded-2xl border border-slate-100 dark:border-murzak-border bg-slate-50/70 dark:bg-white/[0.03] p-5">
                    <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mb-1">Connect your domain</p>
                    <p className="text-label font-medium text-slate-600 dark:text-slate-400 mb-4">
                      Own a domain already? Point an A record at our server, then connect it here — SSL is issued automatically.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={domainInput}
                        onChange={(e) => setDomainInput(e.target.value)}
                        placeholder="shop.yourbusiness.co.ke"
                        className="flex-1 rounded-xl border border-slate-200 dark:border-murzak-border bg-white dark:bg-black/5 px-4 py-2.5 text-[12px] font-bold text-murzak-ink dark:text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-murzak-accent"
                      />
                      <button
                        onClick={submitDomainAttach}
                        disabled={domainSubmitting || !domainInput.trim()}
                        className="px-5 py-2.5 rounded-xl bg-murzak-accent text-murzak-ink font-black text-micro uppercase hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                      >
                        {domainSubmitting ? "Connecting…" : "Connect"}
                      </button>
                    </div>
                    {domainResult && (
                      <p className={`mt-3 text-label font-bold ${domainResult.type === "success" ? "text-emerald-500" : "text-red-500"}`}>
                        {domainResult.text}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
        </>
      )}

      {/* Fixed overlay — lives outside the panes so closing a tab can't strand it. */}
            {deployLogView && (
              <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-murzak-ink/50 backdrop-blur-sm" onClick={() => setDeployLogView(null)}>
                <div
                  className="w-full max-w-2xl max-h-[80vh] bg-[#0a0a0a] border border-white/20 rounded-2xl shadow-2xl overflow-hidden font-mono flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-5 py-3 bg-[#1a1a1a] border-b border-white/10">
                    <span className="text-gray-300 text-xs truncate">Deployment {deployLogView.uuid.slice(0, 12)} — build log</span>
                    <button className="text-gray-500 hover:text-white p-1" onClick={() => setDeployLogView(null)} aria-label="Close log">
                      ✕
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-5">
                    {deployLogView.loading ? (
                      <p className="text-xs text-gray-500">Loading log…</p>
                    ) : (
                      <pre className="whitespace-pre-wrap break-words text-label text-gray-300 leading-relaxed">{deployLogView.logs}</pre>
                    )}
                  </div>
                </div>
              </div>
            )}
    </div>
  );
};

export default ResourceDetail;
