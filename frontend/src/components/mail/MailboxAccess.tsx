import React, { useState } from "react";
import { AlertCircle, Check, ExternalLink, Loader2, Plus } from "lucide-react";
import { addMailbox, MailError, mailboxNameProblem, requestMailCode } from "../../services/mail";
import type { MailStatus } from "../../types";
import SetPasswordDialog from "./SetPasswordDialog";
import PhoneSetupCard from "./PhoneSetupCard";
import { codeRequestMessage, useCooldown } from "./useCooldown";

/**
 * The live part of the status page: each mailbox with its set/change password
 * button, an add-a-mailbox control (code protected, disabled at the plan
 * limit), the webmail link and the "Add to my phone" card.
 */

const MUTED = "text-slate-600 dark:text-slate-400";
const INPUT =
  "w-full rounded-2xl px-4 py-3 min-h-[44px] font-bold bg-white/70 dark:bg-white/5 border border-slate-300 dark:border-murzak-border text-murzak-ink dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-murzak-accent";
const LABEL = "block text-label font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 mb-1.5";
const PRIMARY =
  "inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-3 rounded-2xl font-black text-sm bg-murzak-accent text-murzak-ink disabled:opacity-60";
const SECONDARY =
  "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-2xl font-black text-sm border border-slate-300 dark:border-murzak-border text-murzak-ink dark:text-slate-100 hover:border-murzak-accent disabled:opacity-60";

interface Props {
  token: string;
  status: MailStatus;
  /** Re-reads the status after a change. */
  onChanged: () => void;
}

function AddMailbox({ token, status, onChanged }: Props) {
  const limit = status.plan?.mailboxLimit ?? 0;
  const count = status.plan?.mailboxCount ?? status.mailboxes.length;
  const atLimit = limit > 0 && count >= limit;
  const domain = status.mailboxes[0]?.address.split("@")[1] || "";

  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");
  const [cooldown, startCooldown] = useCooldown();

  const reset = () => { setOpen(false); setSent(false); setName(""); setCode(""); setError(""); };

  const sendCode = async () => {
    setBusy(true);
    setError("");
    try {
      await requestMailCode(token, "add");
      startCooldown(60);
      setSent(true);
    } catch (e) {
      const st = e instanceof MailError ? e.status : 0;
      if (st === 429) startCooldown(60);
      setError(codeRequestMessage(st, e instanceof MailError ? e.message : "We couldn't send the code just now. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const nameProblem = name ? mailboxNameProblem(name) : "";
  const canAdd = !busy && !!name && !nameProblem && /^\d{6}$/.test(code);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;
    setBusy(true);
    setError("");
    try {
      const r = await addMailbox(token, name, code);
      setAdded(r.address);
      reset();
      onChanged();
    } catch (err) {
      setError(err instanceof MailError ? err.fieldErrors.localPart || err.message : "We couldn't add that mailbox. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 pt-5 border-t border-slate-200 dark:border-murzak-border">
      {added && (
        <p role="status" className="mb-3 flex items-start gap-2 text-sm font-black text-emerald-700 dark:text-emerald-400">
          <Check size={16} className="shrink-0 mt-0.5" /> {added} was added. Set its password in the list above.
        </p>
      )}
      {!open && (
        <div>
          <button type="button" onClick={() => { setAdded(""); setOpen(true); }} disabled={atLimit} className={SECONDARY}>
            <Plus size={16} aria-hidden="true" /> Add a mailbox
          </button>
          <p className={`mt-2 text-sm font-semibold ${MUTED}`} id="add-mailbox-note">
            {atLimit
              ? `Your plan includes ${limit} mailbox${limit === 1 ? "" : "es"} and all ${limit === 1 ? "is" : "are"} in use. To add more, move to a bigger plan.`
              : limit > 0
                ? `${count} of ${limit} mailboxes in use.`
                : ""}
          </p>
        </div>
      )}

      {open && (
        <div className="rounded-2xl border border-slate-200 dark:border-murzak-border p-4">
          <h4 className="font-black text-murzak-ink dark:text-slate-100">Add a mailbox</h4>
          {!sent ? (
            <>
              <p className={`mt-1 text-sm font-semibold ${MUTED}`}>
                To keep your account safe, we first send a 6-digit code to the email address you ordered with.
              </p>
              {error && <p role="alert" className="mt-3 flex items-start gap-2 text-sm font-bold text-red-600 dark:text-red-400"><AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}</p>}
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" onClick={sendCode} disabled={busy || cooldown > 0} className={PRIMARY}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                  {cooldown > 0 ? `Send again in ${cooldown}s` : "Send me a code"}
                </button>
                <button type="button" onClick={reset} className={SECONDARY}>Cancel</button>
              </div>
            </>
          ) : (
            <form onSubmit={submit} className="mt-3 space-y-4" noValidate>
              <div>
                <label htmlFor="add-local" className={LABEL}>Mailbox name</label>
                <div className="flex items-center gap-2">
                  <input
                    id="add-local"
                    value={name}
                    onChange={(e) => setName(e.target.value.trim().toLowerCase())}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="sales"
                    aria-describedby="add-local-help"
                    aria-invalid={!!nameProblem}
                    className={INPUT}
                  />
                  {domain && <span className={`shrink-0 text-sm font-black ${MUTED}`}>@{domain}</span>}
                </div>
                <p id="add-local-help" className={`mt-1.5 text-sm font-semibold ${nameProblem ? "text-red-600 dark:text-red-400" : MUTED}`} role={nameProblem ? "alert" : undefined}>
                  {nameProblem || "Lowercase letters, numbers, dots and hyphens."}
                </p>
              </div>
              <div>
                <label htmlFor="add-code" className={LABEL}>6-digit code</label>
                <input
                  id="add-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  className={`${INPUT} tracking-[0.4em] text-lg`}
                />
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={busy || cooldown > 0}
                  className="mt-1 font-black underline text-sm text-sky-700 dark:text-murzak-accent disabled:no-underline disabled:opacity-70 min-h-[44px]"
                >
                  {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
                </button>
              </div>
              {error && <p role="alert" className="flex items-start gap-2 text-sm font-bold text-red-600 dark:text-red-400"><AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}</p>}
              <div className="flex flex-wrap gap-3">
                <button type="submit" disabled={!canAdd} className={PRIMARY}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                  {busy ? "Adding…" : "Add mailbox"}
                </button>
                <button type="button" onClick={reset} className={SECONDARY}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

const MailboxAccess: React.FC<Props> = ({ token, status, onChanged }) => {
  const [dialog, setDialog] = useState<{ address: string; passwordSet: boolean } | null>(null);

  return (
    <>
      <section className="mt-8 rounded-3xl glass-card p-5 sm:p-6" aria-labelledby="mailboxes-heading">
        <h3 id="mailboxes-heading" className="font-black text-murzak-ink dark:text-slate-100">Your mailboxes</h3>
        <ul className="mt-3 space-y-3">
          {status.mailboxes.map((m) => (
            <li key={m.address} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-murzak-ink dark:text-slate-100 break-all">{m.address}</p>
                <p className={`text-xs font-black ${m.passwordSet ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                  {m.passwordSet ? "Password set" : "Needs a password"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDialog({ address: m.address, passwordSet: m.passwordSet })}
                aria-label={`${m.passwordSet ? "Change password" : "Set password"} for ${m.address}`}
                className={m.passwordSet ? SECONDARY : PRIMARY}
              >
                {m.passwordSet ? "Change password" : "Set password"}
              </button>
            </li>
          ))}
        </ul>
        <a
          href={status.webmailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 min-h-[44px] px-6 py-3.5 rounded-2xl font-black text-sm bg-murzak-accent text-murzak-ink"
        >
          Open webmail <ExternalLink size={15} />
        </a>
        <AddMailbox token={token} status={status} onChanged={onChanged} />
      </section>

      <PhoneSetupCard mailboxes={status.mailboxes} webmailUrl={status.webmailUrl} />

      {dialog && (
        <SetPasswordDialog
          token={token}
          address={dialog.address}
          passwordSet={dialog.passwordSet}
          onClose={() => setDialog(null)}
          onDone={onChanged}
        />
      )}
    </>
  );
};

export default MailboxAccess;
