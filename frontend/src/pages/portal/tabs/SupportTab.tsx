import React from "react";
import { Headphones } from "lucide-react";
import { PageHeader, Panel, PButton } from "../../../components/portal/ui";
import { usePortal } from "../PortalContext";
import { PLAN_SLA } from "../../../config/serviceCatalog";
import { normalizePlanToCode } from "../helpers";

/**
 * Help as a place, not a floating modal.
 *
 * The conversation itself still lives in the Contact modal — it is the same
 * thread the admin inbox answers — but a customer looking for "where do I get
 * help, and how fast will you answer" had nowhere to land. This is also the
 * one screen where a plan means something now that plans no longer gate the
 * catalogue: it IS the SLA.
 */
const SupportTab: React.FC = () => {
  const { setIsContactOpen, user } = usePortal();
  const sla = PLAN_SLA[normalizePlanToCode(user.plan)];

  const rows: { label: string; value: string }[] = [
    { label: "First response", value: sla.firstResponse },
    { label: "Backups kept", value: sla.backupRetention },
    { label: "Named contact", value: sla.namedContact ? "Yes" : "Shared team" },
    { label: "Channels", value: sla.channels.join(", ") },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Help" description="Talk to the team in Nairobi. One thread, always the same people." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <Panel title="Message us">
          <p className="text-sm text-p-muted">
            Anything at all: a change, a report, something broken. You'll get a reply in
            this same thread and by email, so nothing gets lost.
          </p>
          <PButton
            variant="primary"
            icon={<Headphones className="w-4 h-4" />}
            onClick={() => setIsContactOpen(true)}
            className="mt-4"
          >
            Open the conversation
          </PButton>
        </Panel>

        <Panel title={`What your ${user.plan || "current"} plan promises`} flush>
          <dl>
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-4 px-4 sm:px-5 py-3 border-b border-p-border last:border-b-0">
                <dt className="text-[13px] text-p-muted">{r.label}</dt>
                <dd className="text-sm font-medium text-p-text text-right">{r.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
};

export default SupportTab;
