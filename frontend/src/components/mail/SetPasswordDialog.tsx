import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { MailError, mailLocalPart, mailPasswordProblem, requestMailCode, setMailboxPassword } from "../../services/mail";
import { useDialogA11y } from "./useDialogA11y";
import { codeRequestMessage, useCooldown } from "./useCooldown";

/**
 * Set (first time) or change (reset) one mailbox's password. A reset first asks
 * for a 6-digit code emailed to the owner. The password lives only in this
 * component's state while the dialog is open: it is cleared on success, on
 * close, and is never logged, stored or put in a URL.
 */

const CODE_GAP_SECONDS = 60;
const INPUT =
  "w-full rounded-2xl px-4 py-3 min-h-[44px] font-bold bg-white/70 dark:bg-white/5 border border-slate-300 dark:border-murzak-border text-murzak-ink dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-murzak-accent";
const LABEL = "block text-label font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 mb-1.5";
const MUTED = "text-slate-600 dark:text-slate-400";
const PRIMARY =
  "inline-flex items-center justify-center gap-2 min-h-[44px] px-6 py-3 rounded-2xl font-black text-sm bg-murzak-accent text-murzak-ink disabled:opacity-60";
const SECONDARY =
  "inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-3 rounded-2xl font-black text-sm border border-slate-300 dark:border-murzak-border text-murzak-ink dark:text-slate-100 hover:border-murzak-accent disabled:opacity-60";

interface Props {
  token: string;
  address: string;
  /** true: this is a change and needs an emailed code; false: first password. */
  passwordSet: boolean;
  onClose: () => void;
  /** Called once the password was saved (the page refreshes its list). */
  onDone: () => void;
}

const RULES: Array<{ id: string; label: string; test: (pw: string) => boolean }> = [
  { id: "len", label: "At least 8 characters", test: (p) => p.length >= 8 && p.length <= 128 },
  { id: "upper", label: "An uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { id: "lower", label: "A lowercase letter", test: (p) => /[a-z]/.test(p) },
  { id: "num", label: "A number", test: (p) => /[0-9]/.test(p) },
];

const SetPasswordDialog: React.FC<Props> = ({ token, address, passwordSet: passwordSetProp, onClose, onDone }) => {
  // Snapshot: the page refreshes after saving and flips the prop, which must not change this dialog mid-flow.
  const [passwordSet] = useState(passwordSetProp);
  const [step, setStep] = useState<"request" | "form" | "done">(passwordSet ? "request" : "form");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, startCooldown] = useCooldown();
  const boxRef = useRef<HTMLDivElement>(null);
  const local = mailLocalPart(address);

  const close = () => { setPw(""); setConfirm(""); setCode(""); onClose(); };
  useDialogA11y(boxRef, close);

  // The button that was focused is replaced when the step changes: put focus on the next thing to do.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const root = boxRef.current;
    if (!root) return;
    (step === "form" ? root.querySelector<HTMLElement>("input") : root.querySelector<HTMLElement>('button:not([aria-label="Close"])'))?.focus();
  }, [step]);

  const sendCode = async () => {
    setBusy(true);
    setError("");
    try {
      await requestMailCode(token, "reset");
      startCooldown(CODE_GAP_SECONDS);
      setStep("form");
    } catch (e) {
      const status = e instanceof MailError ? e.status : 0;
      if (status === 429) startCooldown(CODE_GAP_SECONDS);
      setError(codeRequestMessage(status, e instanceof MailError ? e.message : "We couldn't send the code just now. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const tooLong = pw.length > 128;
  const mismatch = confirm.length > 0 && confirm !== pw;
  const codeOk = !passwordSet || /^\d{6}$/.test(code);
  const canSave = !busy && pw.length > 0 && !mailPasswordProblem(pw) && confirm === pw && codeOk;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError("");
    try {
      await setMailboxPassword(token, local, pw, passwordSet ? code : undefined);
      setPw(""); setConfirm(""); setCode("");
      setStep("done");
      onDone();
    } catch (err) {
      setError(err instanceof MailError ? err.message : "We couldn't set that password. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const title = passwordSet ? "Change password" : "Set password";

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="setpw-title"
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-murzak-ink border border-slate-200 dark:border-murzak-border p-5 sm:p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="setpw-title" className="text-xl font-black text-murzak-ink dark:text-slate-100">{title}</h2>
            <p className={`mt-0.5 text-sm font-bold break-all ${MUTED}`}>{address}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="shrink-0 w-11 h-11 -mr-2 -mt-2 flex items-center justify-center rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <X size={20} />
          </button>
        </div>

        {step === "request" && (
          <div className="mt-5">
            <p className={`font-medium ${MUTED}`}>
              To keep your mail safe, we first send a 6-digit code to the email address you used when you ordered. Then you can choose a new password.
            </p>
            {error && (
              <p role="alert" className="mt-4 flex items-start gap-2 text-sm font-bold text-red-600 dark:text-red-400">
                <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={sendCode} disabled={busy || cooldown > 0} className={PRIMARY}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                {cooldown > 0 ? `Send again in ${cooldown}s` : "Send me a code"}
              </button>
              <button type="button" onClick={close} className={SECONDARY}>Cancel</button>
            </div>
          </div>
        )}

        {step === "form" && (
          <form onSubmit={save} className="mt-5 space-y-4" noValidate>
            {passwordSet && (
              <div>
                <label htmlFor="setpw-code" className={LABEL}>6-digit code</label>
                <input
                  id="setpw-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  aria-describedby="setpw-code-help"
                  className={`${INPUT} tracking-[0.4em] text-lg`}
                />
                <p id="setpw-code-help" className={`mt-1.5 text-sm font-semibold ${MUTED}`}>
                  We sent it to your ordering email. It works for a few minutes.{" "}
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={busy || cooldown > 0}
                    className="font-black underline text-sky-700 dark:text-murzak-accent disabled:no-underline disabled:opacity-70 min-h-[44px] px-1"
                  >
                    {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
                  </button>
                </p>
              </div>
            )}

            <div>
              <label htmlFor="setpw-new" className={LABEL}>{passwordSet ? "New password" : "Password"}</label>
              <div className="relative">
                <input
                  id="setpw-new"
                  type={show ? "text" : "password"}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  autoComplete="new-password"
                  aria-describedby="setpw-rules"
                  className={`${INPUT} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                  aria-pressed={show}
                  className="absolute right-0 top-0 h-full w-12 flex items-center justify-center text-slate-600 dark:text-slate-300"
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <ul id="setpw-rules" className="mt-2 grid grid-cols-1 min-[420px]:grid-cols-2 gap-x-3 gap-y-1" aria-label="Password rules">
                {RULES.map((r) => {
                  const met = r.test(pw);
                  return (
                    <li key={r.id} className={`flex items-center gap-1.5 text-sm font-bold ${met ? "text-emerald-700 dark:text-emerald-400" : MUTED}`}>
                      {met ? (
                        <Check size={14} aria-hidden="true" />
                      ) : (
                        <span className="w-3.5 h-3.5 rounded-full border border-slate-400 dark:border-slate-500 inline-block" aria-hidden="true" />
                      )}
                      {r.label}
                      <span className="sr-only">{met ? " (done)" : " (needed)"}</span>
                    </li>
                  );
                })}
              </ul>
              {tooLong && <p role="alert" className="mt-1.5 text-sm font-bold text-red-600 dark:text-red-400">{mailPasswordProblem(pw)}</p>}
            </div>

            <div>
              <label htmlFor="setpw-confirm" className={LABEL}>Type it again</label>
              <input
                id="setpw-confirm"
                type={show ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                aria-invalid={mismatch}
                className={INPUT}
              />
              {mismatch && <p role="alert" className="mt-1.5 text-sm font-bold text-red-600 dark:text-red-400">The two passwords don't match.</p>}
            </div>

            {error && (
              <p role="alert" className="flex items-start gap-2 text-sm font-bold text-red-600 dark:text-red-400">
                <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
              </p>
            )}

            <div className="flex flex-wrap gap-3 pt-1">
              <button type="submit" disabled={!canSave} className={PRIMARY}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                {busy ? "Saving…" : title}
              </button>
              <button type="button" onClick={close} className={SECONDARY}>Cancel</button>
            </div>
          </form>
        )}

        {step === "done" && (
          <div className="mt-5" role="status">
            <p className="flex items-start gap-2 font-black text-emerald-700 dark:text-emerald-400">
              <Check size={18} className="shrink-0 mt-0.5" /> Password {passwordSet ? "changed" : "set"} for {address}.
            </p>
            <p className={`mt-2 font-medium ${MUTED}`}>
              You can now open your webmail or add this mailbox to your phone. We never show or email your password.
            </p>
            <div className="mt-5">
              <button type="button" onClick={close} className={PRIMARY}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default SetPasswordDialog;
