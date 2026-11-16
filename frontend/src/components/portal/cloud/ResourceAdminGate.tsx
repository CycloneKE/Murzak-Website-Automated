import React, { useCallback, useEffect, useState } from "react";
import { Clock, ShieldCheck } from "lucide-react";
import {
  acceptResourceAdminDisclosure,
  fetchResourceAdminEligibility,
  ResourceAdminEligibility,
} from "../../../services/resourceAdmin";
import { createPortalThread } from "../../../services/portalChat";
import { toUserMessage } from "../../../services/errors";
import { Banner, PButton, Panel } from "../ui";

interface Props {
  serviceId: string;
  serviceName: string;
  isActive: boolean;
  /** What this section lets the customer do. Used in the gate copy. */
  capability: string;
  onRequestUpgrade: () => void;
  /** Fires with true once every gate is open. */
  onActiveChange?: (active: boolean) => void;
  children: React.ReactNode;
}

const CLOSED: ResourceAdminEligibility = { enabled: false, planAllowed: false, approved: false, disclosureAccepted: false };

/**
 * The four-state access gate (kill switch, plan, staff approval, disclosure)
 * shared by every section that changes a live service: environment, logs,
 * healthcheck. Children render only when all gates are open; each gate state
 * names the next real step instead of hiding the section.
 */
const ResourceAdminGate: React.FC<Props> = ({
  serviceId, serviceName, isActive, capability, onRequestUpgrade, onActiveChange, children,
}) => {
  const [eligibility, setEligibility] = useState<ResourceAdminEligibility | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setEligibility(await fetchResourceAdminEligibility()); } catch { setEligibility(CLOSED); }
  }, []);

  useEffect(() => { load(); }, [load, serviceId]);

  const open = !!eligibility?.enabled && !!eligibility.planAllowed && !!eligibility.approved && !!eligibility.disclosureAccepted;
  useEffect(() => { onActiveChange?.(open && isActive); }, [open, isActive, onActiveChange]);

  if (!isActive) {
    return <Banner tone="info">This service is not running yet. These controls open once it is active.</Banner>;
  }
  if (!eligibility) return <Panel><p className="text-[13px] text-p-muted">Checking access…</p></Panel>;
  if (!eligibility.enabled) {
    return <Banner tone="info">These controls are not available yet. Contact support if you need a change made.</Banner>;
  }
  if (!eligibility.planAllowed) {
    return (
      <Panel title="Available on Business and above" description={`${capability} is part of the Business plan.`}>
        <PButton variant="primary" onClick={onRequestUpgrade}>Request upgrade</PButton>
      </Panel>
    );
  }
  if (!eligibility.approved) {
    const request = async () => {
      setRequesting(true);
      setError("");
      try {
        await createPortalThread({
          subject: `Resource Admin Access Request: ${serviceName}`,
          message: `I'd like advanced controls (${capability.toLowerCase()}) for ${serviceName} (${serviceId}).`,
        });
        setRequestSent(true);
      } catch (e: any) {
        setError(toUserMessage(e, "Couldn't send that request."));
      } finally {
        setRequesting(false);
      }
    };
    return (
      <Panel title="Needs a quick approval" description={`${capability} changes your live service, so our team approves access first.`}>
        <div className="flex items-start gap-3">
          <Clock className="w-4 h-4 text-p-warning shrink-0 mt-0.5" />
          <p className="text-[13px] text-p-muted grow">
            {requestSent
              ? "Request sent. We'll follow up in your Support tab, usually the same day."
              : "It usually takes less than a day."}
          </p>
        </div>
        {error && <p role="alert" className="mt-3 text-[13px] text-p-danger">{error}</p>}
        {!requestSent && (
          <PButton className="mt-4" variant="primary" loading={requesting} onClick={request}>Request access</PButton>
        )}
      </Panel>
    );
  }
  if (!eligibility.disclosureAccepted) {
    const accept = async () => {
      setAccepting(true);
      setError("");
      try {
        await acceptResourceAdminDisclosure();
        await load();
      } catch (e: any) {
        setError(toUserMessage(e, "Failed to record acceptance."));
      } finally {
        setAccepting(false);
      }
    };
    return (
      <Panel title="Before you take the wheel">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-4 h-4 text-p-accent-text shrink-0 mt-0.5" />
          <div className="text-[13px] text-p-muted space-y-2">
            <p>
              These controls change your live service directly. A bad setting can stop it from starting, and
              removing something your app depends on will break it until you put it back. Most changes apply
              only after a restart, which briefly interrupts the service.
            </p>
            <p>We keep the platform running underneath you, but configuration you change here becomes yours to maintain.</p>
          </div>
        </div>
        {error && <p role="alert" className="mt-3 text-[13px] text-p-danger">{error}</p>}
        <PButton className="mt-4" variant="primary" loading={accepting} onClick={accept}>I understand and agree</PButton>
      </Panel>
    );
  }
  return <>{children}</>;
};

export default ResourceAdminGate;
