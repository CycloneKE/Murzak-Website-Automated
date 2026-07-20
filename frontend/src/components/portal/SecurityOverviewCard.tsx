import React, { useEffect, useState } from 'react';
import { ShieldCheck, Server, Lock } from 'lucide-react';

// Backup/edge rows now read the REAL per-tenant aggregate from
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

const SUMMARY_LABEL: Record<Summary, { text: string; tone: string }> = {
  configured: { text: "Configured", tone: "text-murzak-success" },
  partial: { text: "Partially configured", tone: "text-orange-400" },
  failed: { text: "Attention needed", tone: "text-red-400" },
  not_configured: { text: "Not configured yet", tone: "text-slate-500" },
  none: { text: "Not tracked yet", tone: "text-slate-500" },
};

function summaryChip(summary: Summary | undefined, available: boolean) {
  const s = available && summary ? SUMMARY_LABEL[summary] : SUMMARY_LABEL.none;
  return (
    <span className={`text-micro font-black uppercase ${s.tone}`}>{s.text}</span>
  );
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

  return (
    <div className="glass-panel p-8 rounded-[3rem] border border-murzak-border h-full relative overflow-hidden group">
      <div className="absolute top-0 right-0 w-32 h-32 bg-murzak-accent/5 rounded-bl-full blur-3xl transition-all duration-1000 group-hover:bg-murzak-accent/10"></div>

      <div className="flex items-center justify-between mb-8 relative z-10">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-2xl text-green-400">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h3 className="text-[12px] font-black uppercase tracking-widest text-murzak-ink">Security & Integrity</h3>
            <p className="text-micro font-medium text-slate-600 dark:text-slate-400 mt-1">Automated protection active</p>
          </div>
        </div>
      </div>

      <div className="space-y-6 relative z-10">
        <div className="flex items-center justify-between p-4 bg-black/5 border border-murzak-border/50 rounded-2xl">
          <div className="flex items-center gap-3">
            <Server size={16} className="text-murzak-accent" />
            <div>
              <p className="text-micro font-bold uppercase text-slate-600 dark:text-slate-400">Uptime SLA</p>
              <p className="text-xs text-slate-500">Contractual commitment</p>
            </div>
          </div>
          <span className="text-lg font-black text-murzak-ink">99.9%</span>
        </div>

        <div className="flex items-center justify-between p-4 bg-black/5 border border-murzak-border/50 rounded-2xl">
          <div className="flex items-center gap-3">
            <ShieldCheck size={16} className="text-slate-500" />
            <div>
              <p className="text-micro font-bold uppercase text-slate-600 dark:text-slate-400">Backups</p>
              <p className="text-xs text-slate-500">
                {available && overview?.services
                  ? `Across ${overview.services} provisioned service${overview.services === 1 ? "" : "s"}`
                  : "Verified & encrypted, when run"}
              </p>
            </div>
          </div>
          {summaryChip(overview?.backup, available)}
        </div>

        <div className="flex items-center justify-between p-4 bg-black/5 border border-murzak-border/50 rounded-2xl">
          <div className="flex items-center gap-3">
            <Lock size={16} className="text-slate-500" />
            <div>
              <p className="text-micro font-bold uppercase text-slate-600 dark:text-slate-400">Edge / WAF</p>
              <p className="text-xs text-slate-500">Per-service edge protection</p>
            </div>
          </div>
          {summaryChip(overview?.edge, available)}
        </div>
      </div>
    </div>
  );
};

export default SecurityOverviewCard;
