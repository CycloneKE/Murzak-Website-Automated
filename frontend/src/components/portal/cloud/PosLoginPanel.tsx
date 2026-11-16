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
    <div className="mt-4 rounded-lg border border-p-border bg-p-panel-2 p-5">
      <div className="flex items-center gap-3 mb-3">
        <KeyRound className="w-5 h-5 text-p-accent-text" />
        <p className="text-xs font-semibold text-p-muted ">Your POS login</p>
      </div>
      <div className="space-y-1.5">
        <CredentialRow label="POS" value={posUrl} />
        <CredentialRow label="Email" value={login.user} />
        {login.password && (
          <CredentialRow label="Password" value={login.password} secret revealed={revealed} onToggle={() => setRevealed((r) => !r)} />
        )}
      </div>
      <p className="text-[13px] font-medium text-p-muted mt-3 leading-relaxed">
        {login.password
          ? "Sign in, set up your shop, then change this password from the account menu in your POS. Add your cashiers and staff from inside the POS."
          : "Sign in with the password you already use for this POS. Forgotten it? Message support and we'll reset it."}
      </p>
    </div>
  );
};

export default PosLoginPanel;
