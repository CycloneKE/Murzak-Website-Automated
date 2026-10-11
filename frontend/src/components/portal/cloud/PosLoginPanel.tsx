import React, { useState } from "react";
import { KeyRound } from "lucide-react";
import { CredentialRow } from "./DatabaseConnectionPanel";

interface PosLoginPanelProps {
  posUrl: string;
  login: { user: string; password: string };
}

/**
 * The owner's sign-in for their own Murzak POS (<shop>.pos.murzaktech.tech).
 *
 * The POS has no public sign-up — the account is created when the shop is
 * provisioned, so this panel is the only place the owner gets it. Staff
 * accounts are then added by the owner from inside the POS.
 */
const PosLoginPanel: React.FC<PosLoginPanelProps> = ({ posUrl, login }) => {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="mt-4 rounded-2xl border border-slate-100 dark:border-murzak-border bg-slate-50/70 dark:bg-white/3 p-5">
      <div className="flex items-center gap-3 mb-3">
        <KeyRound className="w-5 h-5 text-murzak-accent" />
        <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Your POS login</p>
      </div>
      <div className="space-y-1.5">
        <CredentialRow label="POS" value={posUrl} />
        <CredentialRow label="Email" value={login.user} />
        {login.password && (
          <CredentialRow label="Password" value={login.password} secret revealed={revealed} onToggle={() => setRevealed((r) => !r)} />
        )}
      </div>
      <p className="text-label font-medium text-slate-500 mt-3 leading-relaxed">
        {login.password
          ? "Sign in, set up your shop, then change this password from the account menu in your POS. Add your cashiers and staff from inside the POS."
          : "Sign in with the password you already use for this POS. Forgotten it? Message support and we'll reset it."}
      </p>
    </div>
  );
};

export default PosLoginPanel;
