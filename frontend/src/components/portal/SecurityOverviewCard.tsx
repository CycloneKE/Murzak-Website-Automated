import React, { useEffect, useState } from 'react';
import { ShieldCheck, Server, Lock } from 'lucide-react';
import { Panel, StatusPill, type PillTone } from './ui';

// Backup/firewall rows read the REAL per-tenant aggregate from
// /api/portal/security-overview (the Provisioning Job backup_status /
// edge_status enums the runner records at create-time). There is still no
// per-tenant backup TIMESTAMP or WAF hit counter — when the aggregate isn't
// available (no provisioned services, endpoint degraded) the rows keep the
// honest "Not tracked yet" instead of a fabricated value.
type Summary = "configured" | "partial" | "failed" | "not_configured" | "none";

interface SecurityOverview {
  available: boolean;
  services?: number;
  backup?: Summary;
  edge?: Summary;
  lastUpdated?: string;
}

const SUMMARY_LABEL: Record<Summary, { text: string; tone: PillTone }> = {
  configured: { text: "Configured", tone: "ok" },
  partial: { text: "Partially configured", tone: "warn" },
  failed: { text: "Attention needed", tone: "bad" },
  not_configured: { text: "Not configured yet", tone: "idle" },
  none: { text: "Not tracked yet", tone: "idle" },
};

function summaryChip(summary: Summary | undefined, available: boolean) {
  const s = available && summary ? SUMMARY_LABEL[summary] : SUMMARY_LABEL.none;
  return <StatusPill tone={s.tone}>{s.text}</StatusPill>;
}

const SecurityOverviewCard: React.FC = () => {
  const [overview, setOverview] = useState<SecurityOverview | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/portal/security-overview", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.ok) setOverview(d);
      })
      .catch(() => {
        /* degrade to the honest fallback rows */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const available = !!overview?.available;

  const rows = [
    {
      icon: <Server size={16} />,
      label: "Uptime commitment",
      hint: "In your service agreement",
      value: <span className="text-sm font-semibold text-p-text">99.9%</span>,
    },
    {
      icon: <ShieldCheck size={16} />,
      label: "Backups",
      hint:
        available && overview?.services
          ? `Across ${overview.services} provisioned service${overview.services === 1 ? "" : "s"}`
          : "Verified & encrypted, when run",
      value: summaryChip(overview?.backup, available),
    },
    {
      icon: <Lock size={16} />,
      label: "Firewall",
      hint: "Protection in front of each service",
      value: summaryChip(overview?.edge, available),
    },
  ];

  return (
    <Panel title="Security" description="How your services are protected." flush className="h-full">
      <ul className="divide-y divide-p-border">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="shrink-0 text-p-muted">{r.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-p-text">{r.label}</p>
                <p className="text-[13px] text-p-muted truncate">{r.hint}</p>
              </div>
            </div>
            <span className="shrink-0">{r.value}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
};

export default SecurityOverviewCard;
