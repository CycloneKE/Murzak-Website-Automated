import React, { useEffect, useState } from "react";
import { attachDomainToService, detachDomain, fetchCustomerDomains } from "../../../services/hostingPortal";
import { type CustomerDomain } from "../../../types/hosting";

/**
 * The account's domains, independent of any service.
 *
 * First slice out of usePortalState, which had grown to ~1,380 lines holding
 * every unrelated concern in one closure. This one owns its state end to end
 * and touches nothing else, which is exactly why it went first.
 */
export function useCustomerDomains() {
  // --- Domains ---
  // The account's domains, independent of any service. Loaded once for the
  // portal rather than per-tab so the sidebar count and the tab agree.
  const [domains, setDomains] = useState<CustomerDomain[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(true);
  const [domainsError, setDomainsError] = useState("");
  const [domainBusyId, setDomainBusyId] = useState<string>("");
  const [domainNotice, setDomainNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const refreshDomains = React.useCallback(async () => {
    setDomainsError("");
    try {
      setDomains(await fetchCustomerDomains());
    } catch (e: any) {
      setDomainsError(e?.message || "Failed to load your domains.");
    } finally {
      setDomainsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshDomains();
  }, [refreshDomains]);

  const attachDomain = async (domainId: string, serviceId: string) => {
    setDomainBusyId(domainId);
    setDomainNotice(null);
    try {
      await attachDomainToService(domainId, serviceId);
      await refreshDomains();
      setDomainNotice({ type: "success", text: "Domain pointed at your service. DNS can take a little while to update everywhere." });
    } catch (e: any) {
      setDomainNotice({ type: "error", text: e?.message || "Failed to attach this domain." });
    } finally {
      setDomainBusyId("");
    }
  };

  const detachCustomerDomain = async (domainId: string) => {
    setDomainBusyId(domainId);
    setDomainNotice(null);
    try {
      await detachDomain(domainId);
      await refreshDomains();
      setDomainNotice({ type: "success", text: "Domain detached. You still own it — attach it somewhere whenever you like." });
    } catch (e: any) {
      setDomainNotice({ type: "error", text: e?.message || "Failed to detach this domain." });
    } finally {
      setDomainBusyId("");
    }
  };

  return {
    attachDomain,
    detachCustomerDomain,
    domainBusyId,
    domainNotice,
    domains,
    domainsError,
    domainsLoading,
    refreshDomains,
    setDomainNotice,
  };
}
