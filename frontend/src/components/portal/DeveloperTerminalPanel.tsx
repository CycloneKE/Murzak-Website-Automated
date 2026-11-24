import React, { useEffect, useState } from "react";
import { Terminal, ShieldCheck, Clock } from "lucide-react";
import { fetchTerminalEligibility, acceptTerminalDisclosure, TerminalEligibility } from "../../services/terminal";
import TerminalView from "./TerminalView";
import { toUserMessage } from "../../services/errors";

interface DeveloperTerminalPanelProps {
  serviceId: string;
  isActive: boolean;
  /** Opens the existing Developer Upsell request modal (Portal.tsx's developerUpsellSvc flow). */
  onRequestUpgrade: () => void;
}

/**
 * Allocated (non-floating) panel for the developer-access terminal — lives
 * inline in the service detail page, always occupying its own layout space.
 * Renders one of four states based on eligibility; the actual shell (Phase
 * 5.3 broker bridge) is a separate, later piece of work — see
 * docs/superpowers/specs/2026-07-19-developer-terminal-access-design.md.
 */
const DeveloperTerminalPanel: React.FC<DeveloperTerminalPanelProps> = ({ serviceId, isActive, onRequestUpgrade }) => {
  const [eligibility, setEligibility] = useState<TerminalEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      setLoading(true);
      fetchTerminalEligibility()
        .then((result) => {
          if (!cancelled) setEligibility(result);
        })
        .catch(() => {
          if (!cancelled) setEligibility({ enterprisePlan: false, approved: false, disclosureAccepted: false });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  const handleAccept = async () => {
    // Note: initiatedServiceId and serviceId both close over this render's
    // serviceId value, so the `initiatedServiceId === serviceId` checks below
    // are always true within a single invocation — they do NOT detect a
    // mid-flight prop change. That's fine in practice: if serviceId actually
    // changes while this request is in flight, the useEffect above re-fetches
    // eligibility for the new serviceId and overwrites whatever this call
    // sets. These checks are left in as harmless, self-documenting intent
    // rather than a real staleness guard.
    const initiatedServiceId = serviceId;
    setAccepting(true);
    setAcceptError("");
    try {
      await acceptTerminalDisclosure();
      if (initiatedServiceId === serviceId) {
        setLoading(true);
        fetchTerminalEligibility()
          .then((result) => {
            if (initiatedServiceId === serviceId) setEligibility(result);
          })
          .catch(() => {
            if (initiatedServiceId === serviceId) setEligibility({ enterprisePlan: false, approved: false, disclosureAccepted: false });
          })
          .finally(() => {
            if (initiatedServiceId === serviceId) setLoading(false);
          });
      }
    } catch (e: any) {
      if (initiatedServiceId === serviceId) {
        setAcceptError(toUserMessage(e, "Failed to record acceptance."));
      }
    } finally {
      if (initiatedServiceId === serviceId) {
        setAccepting(false);
      }
    }
  };

  if (!isActive) return null;

  return (
    <div className="mt-4 rounded-lg border border-p-border bg-p-panel-2 p-5">
      <div className="flex items-center gap-3 mb-3">
        <Terminal className="w-5 h-5 text-p-accent-text" />
        <p className="text-xs font-semibold text-p-muted ">Developer Access</p>
      </div>

      {loading ? (
        <p className="text-[13px] font-medium text-p-muted">Checking access…</p>
      ) : !eligibility?.enterprisePlan ? (
        <div>
          <p className="text-[13px] font-medium text-p-muted mb-3">
            A jailed shell into this service is available on the Enterprise plan.
          </p>
          <button
            type="button"
            onClick={onRequestUpgrade}
            className="px-4 py-2 rounded-md bg-p-accent text-p-accent-fg text-xs font-semibold transition"
          >
            Request Upgrade
          </button>
        </div>
      ) : !eligibility.approved ? (
        <div className="flex items-start gap-3">
          <Clock className="w-4 h-4 text-p-warning shrink-0 mt-0.5" />
          <p className="text-[13px] font-medium text-p-muted ">
            Your developer access request is awaiting approval from our team. You'll be able to
            connect as soon as it's confirmed.
          </p>
        </div>
      ) : !eligibility.disclosureAccepted ? (
        <div>
          <div className="flex items-start gap-3 mb-4">
            <ShieldCheck className="w-4 h-4 text-p-accent-text shrink-0 mt-0.5" />
            <div className="text-[13px] font-medium text-p-muted space-y-2">
              <p>
                Before your first session, please review: this shell runs inside your own service's
                container. You'll be able to see its internal network address, hostname, and
                running processes. Sessions are recorded for security and audit purposes. Use is
                limited to your own service; attempting to reach other tenants or the host is not
                permitted and will end your access.
              </p>
            </div>
          </div>
          {acceptError && <p className="text-[13px] font-medium text-p-danger mb-3">{acceptError}</p>}
          <button
            type="button"
            onClick={handleAccept}
            disabled={accepting}
            className="px-4 py-2 rounded-md bg-p-accent text-p-accent-fg text-xs font-semibold transition disabled:opacity-60"
          >
            {accepting ? "Saving…" : "I understand and agree"}
          </button>
        </div>
      ) : (
        <TerminalView key={serviceId} serviceId={serviceId} />
      )}
    </div>
  );
};

export default DeveloperTerminalPanel;
