import React, { useEffect, useState } from "react";
import { Globe, Inbox, Server, ExternalLink, Terminal, Ticket } from "lucide-react";
import AdminInbox from "./AdminInbox";
import AdminProvisioning from "./AdminProvisioning";
import AdminDomains from "./AdminDomains";
import { getInfraLinks, InfraLinks } from "../../services/adminProvisioning";

type AdminView = "inbox" | "domains" | "provisioning";

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
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-micro font-black uppercase border border-slate-200 dark:border-murzak-border bg-white/60 dark:bg-black/5 text-slate-600 dark:text-slate-400 hover:text-murzak-accent hover:border-murzak-accent/40 transition"
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
type AdminTabsProps = {
  /** Bubbles the inbox unread count up so the portal sidebar badge matches. */
  onUnreadChange?: (count: number) => void;
};

const AdminTabs: React.FC<AdminTabsProps> = ({ onUnreadChange }) => {
  const [view, setView] = useState<AdminView>("inbox");
  const [unread, setUnread] = useState(0);
  const [domainsPending, setDomainsPending] = useState(0);

  const handleUnreadChange = React.useCallback(
    (count: number) => {
      setUnread(count);
      onUnreadChange?.(count);
    },
    [onUnreadChange]
  );

  const tab = (id: AdminView, label: string, icon: React.ReactNode, badge?: number) => (
    <button
      type="button"
      onClick={() => setView(id)}
      className={`inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-2xl text-micro font-black uppercase border transition ${
        view === id
          ? "bg-murzak-accent text-murzak-ink border-transparent shadow-md"
          : "bg-white/60 dark:bg-black/5 border-slate-200 dark:border-murzak-border text-slate-500 hover:text-murzak-accent hover:border-murzak-accent/40"
      }`}
    >
      {icon} {label}
      {!!badge && (
        <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-black">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );

  return (
    <div className="w-full">
      <InfraAccessBar />
      <div className="mb-6 flex items-center gap-2">
        {tab("inbox", "Inbox", <Inbox className="w-4 h-4" />, unread)}
        {tab("domains", "Domains", <Globe className="w-4 h-4" />, domainsPending)}
        {tab("provisioning", "Provisioning", <Server className="w-4 h-4" />)}
      </div>
      {/* Inbox and Domains stay mounted so their polls keep both badges live
          while staff work in another tab — the whole point of the badges. */}
      <div className={view === "inbox" ? "" : "hidden"}>
        <AdminInbox onUnreadChange={handleUnreadChange} />
      </div>
      <div className={view === "domains" ? "" : "hidden"}>
        <AdminDomains onActionableChange={setDomainsPending} />
      </div>
      {view === "provisioning" && <AdminProvisioning />}
    </div>
  );
};

export default AdminTabs;
