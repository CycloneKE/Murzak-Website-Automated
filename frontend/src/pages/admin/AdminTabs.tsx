import React, { useEffect, useState } from "react";
import { Inbox, Server, ExternalLink, Terminal, Ticket } from "lucide-react";
import AdminInbox from "./AdminInbox";
import AdminProvisioning from "./AdminProvisioning";
import { getInfraLinks, InfraLinks } from "../../services/adminProvisioning";

type AdminView = "inbox" | "provisioning";

/**
 * Redirects for staff troubleshooting — Hostinger's own hPanel (built-in
 * browser SSH terminal onto the shared box) and Frappe's Helpdesk ticketing
 * module. We deliberately don't run our own shell broker onto a shared
 * multi-tenant server; these open the providers' own tooling in a new tab.
 */
const InfraAccessBar: React.FC = () => {
  const [links, setLinks] = useState<InfraLinks | null>(null);

  useEffect(() => {
    getInfraLinks().then(setLinks).catch(() => setLinks(null));
  }, []);

  if (!links) return null;

  const LinkBtn: React.FC<{ href: string; icon: React.ReactNode; label: string }> = ({ href, icon, label }) =>
    !href ? null : (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-slate-200 dark:border-murzak-border bg-white/60 dark:bg-black/5 text-slate-500 hover:text-murzak-accent hover:border-murzak-accent/40 transition"
      >
        {icon} {label} <ExternalLink className="w-3 h-3 opacity-60" />
      </a>
    );

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <LinkBtn href={links.hostingerUrl} icon={<Terminal className="w-4 h-4" />} label="Hostinger Terminal" />
      <LinkBtn href={links.frappeTicketingUrl} icon={<Ticket className="w-4 h-4" />} label="Frappe Ticketing" />
    </div>
  );
};

/**
 * Admin area shell — a small sub-navigation that toggles between the support
 * Inbox and the Provisioning control panel. Used wherever the portal renders the
 * admin experience.
 */
const AdminTabs: React.FC = () => {
  const [view, setView] = useState<AdminView>("inbox");

  const tab = (id: AdminView, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setView(id)}
      className={`inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition ${
        view === id
          ? "bg-murzak-accent text-murzak-ink border-transparent shadow-md"
          : "bg-white/60 dark:bg-black/5 border-slate-200 dark:border-murzak-border text-slate-500 hover:text-murzak-accent hover:border-murzak-accent/40"
      }`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div className="w-full">
      <InfraAccessBar />
      <div className="mb-6 flex items-center gap-2">
        {tab("inbox", "Inbox", <Inbox className="w-4 h-4" />)}
        {tab("provisioning", "Provisioning", <Server className="w-4 h-4" />)}
      </div>
      {view === "inbox" ? <AdminInbox /> : <AdminProvisioning />}
    </div>
  );
};

export default AdminTabs;
