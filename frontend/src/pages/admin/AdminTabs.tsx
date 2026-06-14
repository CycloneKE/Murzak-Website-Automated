import React, { useState } from "react";
import { Inbox, Server } from "lucide-react";
import AdminInbox from "./AdminInbox";
import AdminProvisioning from "./AdminProvisioning";

type AdminView = "inbox" | "provisioning";

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
          ? "bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy border-transparent shadow-md"
          : "bg-white/60 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 hover:text-murzak-cyan hover:border-murzak-cyan/40"
      }`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div className="w-full">
      <div className="mb-6 flex items-center gap-2">
        {tab("inbox", "Inbox", <Inbox className="w-4 h-4" />)}
        {tab("provisioning", "Provisioning", <Server className="w-4 h-4" />)}
      </div>
      {view === "inbox" ? <AdminInbox /> : <AdminProvisioning />}
    </div>
  );
};

export default AdminTabs;
