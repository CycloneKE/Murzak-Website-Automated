import React, { useEffect, useState } from "react";
import {
  attachDomainToService,
  createDomainPurchaseRequest,
  createExternalDomainConnection,
  createMurzakSubdomain,
  detachDomain,
  fetchCustomerDomains,
} from "../../../services/hostingPortal";
import { type CustomerDomain } from "../../../types/hosting";
import { toUserMessage } from "../../../services/errors";

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
      setDomainsError(toUserMessage(e, "Failed to load your domains."));
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
      setDomainNotice({ type: "error", text: toUserMessage(e, "Failed to attach this domain.") });
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
      setDomainNotice({ type: "error", text: toUserMessage(e, "Failed to detach this domain.") });
    } finally {
      setDomainBusyId("");
    }
  };

  // --- Self-service intake (register / bring your own / free subdomain) ---
  // Three existing endpoints already do this work headlessly — the customer
  // used to have to open a support chat instead of using them because
  // nothing in the portal called them outside the buy-hosting flow.
  const requestNewDomain = async (input: { requestedName: string; requestedTld: string; notes?: string }) => {
    await createDomainPurchaseRequest(input);
    await refreshDomains();
    setDomainNotice({ type: "success", text: "Domain registration requested — we'll email you once it's live." });
  };

  const connectExternalDomain = async (input: { domainName: string; registrar?: string; notes?: string }) => {
    await createExternalDomainConnection(input);
    await refreshDomains();
    setDomainNotice({ type: "success", text: "Domain connection requested — point it at us and we'll verify it." });
  };

  const requestFreeSubdomain = async (input: { requestedLabel: string; notes?: string }) => {
    await createMurzakSubdomain({ requestedLabel: input.requestedLabel, targetType: "folder", targetValue: "", notes: input.notes });
    await refreshDomains();
    setDomainNotice({ type: "success", text: "Free subdomain requested — it'll appear here once it's set up." });
  };

  return {
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
    setDomainNotice,
  };
}
