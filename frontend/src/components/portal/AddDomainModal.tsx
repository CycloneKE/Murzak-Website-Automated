import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ArrowLeft, Gift, Globe, Link2, Loader2, ShieldCheck, X } from "lucide-react";

/**
 * Self-service domain onboarding — three intake endpoints already existed
 * (register / bring-your-own / free subdomain) but the only customer-facing
 * entry point was "open a support chat." This replaces that with a guided
 * screen that calls those endpoints directly; a human still has to fulfil a
 * registration or verify a connection afterward (registrar automation is
 * blocked on the API's terms — see services/customerDomains.js), but the
 * customer no longer has to ask a person to start that process.
 */

type DomainPath = "register" | "external" | "subdomain";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onRequestNewDomain: (input: { requestedName: string; requestedTld: string; notes?: string }) => Promise<void>;
  onConnectExternalDomain: (input: { domainName: string; registrar?: string; notes?: string }) => Promise<void>;
  onRequestFreeSubdomain: (input: { requestedLabel: string; notes?: string }) => Promise<void>;
};

const TLD_OPTIONS = [".com", ".co.ke", ".net", ".org", ".tech", ".africa"];

const PATHS: Array<{
  id: DomainPath;
  icon: React.ReactNode;
  title: string;
  description: string;
}> = [
  {
    id: "register",
    icon: <Globe className="w-5 h-5" />,
    title: "Register a new domain",
    description: "Pick a name — we handle registration and it appears here once it's live.",
  },
  {
    id: "external",
    icon: <Link2 className="w-5 h-5" />,
    title: "Connect a domain you own",
    description: "Already have one elsewhere? Point it at us and we'll verify it.",
  },
  {
    id: "subdomain",
    icon: <Gift className="w-5 h-5" />,
    title: "Free murzaktech.com subdomain",
    description: "No cost, live almost instantly — good for testing or a quick launch.",
  },
];

export default function AddDomainModal({
  isOpen,
  onClose,
  onRequestNewDomain,
  onConnectExternalDomain,
  onRequestFreeSubdomain,
}: Props) {
  const [path, setPath] = useState<DomainPath | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrollYRef = useRef(0);

  // Register-a-domain fields
  const [name, setName] = useState("");
  const [tld, setTld] = useState(TLD_OPTIONS[0]);
  // Bring-your-own fields
  const [domainName, setDomainName] = useState("");
  const [registrar, setRegistrar] = useState("");
  // Free subdomain fields
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setPath(null);
      setErr("");
      setSubmitting(false);
      setName("");
      setTld(TLD_OPTIONS[0]);
      setDomainName("");
      setRegistrar("");
      setLabel("");
    }
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const y = window.scrollY || 0;
    scrollYRef.current = y;
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${y}px`;
    document.body.style.width = "100%";
    return () => {
      document.body.style.overflow = prev.overflow;
      document.body.style.position = prev.position;
      document.body.style.top = prev.top;
      document.body.style.width = prev.width;
      window.scrollTo(0, scrollYRef.current || 0);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const submit = async (fn: () => Promise<void>) => {
    setErr("");
    setSubmitting(true);
    try {
      await fn();
      onClose();
    } catch (e: any) {
      setErr(e?.message || "That didn't go through — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const registerLabelValid = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(name.trim());
  const subdomainLabelValid = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label.trim());
  const domainNameValid = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(
    domainName.trim()
  );

  return createPortal(
    <div className="fixed inset-0 z-[140]">
      <div className="absolute inset-0 bg-murzak-ink/50 backdrop-blur-xl" onClick={onClose} />
      <div className="relative z-10 flex min-h-full items-center justify-center p-3 sm:p-6">
        <div className="relative w-full max-w-xl max-h-[92vh] bg-white/95 dark:bg-murzak-ink/95 backdrop-blur-xl rounded-2xl sm:rounded-[2.5rem] overflow-hidden border border-murzak-border flex flex-col min-h-0 shadow-2xl">
          <div className="px-5 sm:px-8 py-4 sm:py-5 border-b border-murzak-accent/20 bg-murzak-ink text-white flex items-start justify-between gap-3">
            <div className="min-w-0 flex items-center gap-3">
              {path && (
                <button
                  type="button"
                  onClick={() => { setErr(""); setPath(null); }}
                  className="shrink-0 rounded-xl p-2 border border-white/15 text-white/80 hover:text-murzak-accent hover:border-murzak-accent transition-all"
                  aria-label="Back"
                >
                  <ArrowLeft size={18} />
                </button>
              )}
              <div className="min-w-0">
                <p className="text-micro font-black uppercase text-murzak-accent/90">Domains</p>
                <h3 className="text-lg sm:text-2xl font-black tracking-tighter text-white mt-0.5 leading-tight">
                  {path ? PATHS.find((p) => p.id === path)?.title : "Add a domain"}
                </h3>
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-xl p-2 sm:p-3 border border-white/15 text-white/80 hover:text-murzak-accent hover:border-murzak-accent transition-all bg-black/5"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          <div ref={bodyRef} className="p-5 sm:p-6 flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {!path && (
              <div className="grid grid-cols-1 gap-3">
                {PATHS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPath(p.id)}
                    className="text-left rounded-[1.5rem] p-5 border border-murzak-accent/25 bg-white/60 dark:bg-black/5 hover:border-murzak-accent/60 transition-all flex items-start gap-4"
                  >
                    <div className="shrink-0 w-10 h-10 rounded-2xl bg-murzak-accent/15 text-murzak-accent flex items-center justify-center">
                      {p.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-murzak-ink dark:text-slate-100">{p.title}</p>
                      <p className="text-micro font-bold text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                        {p.description}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {path === "register" && (
              <div className="space-y-4">
                <div>
                  <label className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">
                    Domain name
                  </label>
                  <div className="mt-2 flex gap-2">
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="yourbrand"
                      className="flex-1 h-12 px-4 rounded-xl bg-slate-50 dark:bg-black/5 border border-slate-200 dark:border-murzak-border text-sm font-bold text-murzak-ink dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-murzak-accent"
                    />
                    <select
                      value={tld}
                      onChange={(e) => setTld(e.target.value)}
                      className="h-12 px-3 rounded-xl bg-slate-50 dark:bg-black/5 border border-slate-200 dark:border-murzak-border text-sm font-black text-murzak-ink dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-murzak-accent"
                    >
                      {TLD_OPTIONS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  {name && !registerLabelValid && (
                    <p className="mt-2 text-micro font-bold text-red-500">That doesn't look like a valid domain label.</p>
                  )}
                </div>
                <p className="text-micro font-bold text-slate-500 dark:text-slate-400 leading-relaxed">
                  This creates a registration request against your active hosting plan. We'll email you once {name || "yourbrand"}{tld} is live.
                </p>
                {err && <ErrorBanner text={err} />}
                <SubmitButton
                  submitting={submitting}
                  disabled={!registerLabelValid}
                  label="Request this domain"
                  onClick={() =>
                    submit(() => onRequestNewDomain({ requestedName: name.trim(), requestedTld: tld }))
                  }
                />
              </div>
            )}

            {path === "external" && (
              <div className="space-y-4">
                <div>
                  <label className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">
                    Domain name
                  </label>
                  <input
                    autoFocus
                    value={domainName}
                    onChange={(e) => setDomainName(e.target.value)}
                    placeholder="yourbrand.com"
                    className="mt-2 w-full h-12 px-4 rounded-xl bg-slate-50 dark:bg-black/5 border border-slate-200 dark:border-murzak-border text-sm font-bold text-murzak-ink dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-murzak-accent"
                  />
                  {domainName && !domainNameValid && (
                    <p className="mt-2 text-micro font-bold text-red-500">That doesn't look like a valid domain.</p>
                  )}
                </div>
                <div>
                  <label className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">
                    Where it's registered (optional)
                  </label>
                  <input
                    value={registrar}
                    onChange={(e) => setRegistrar(e.target.value)}
                    placeholder="e.g. GoDaddy, Namecheap"
                    className="mt-2 w-full h-12 px-4 rounded-xl bg-slate-50 dark:bg-black/5 border border-slate-200 dark:border-murzak-border text-sm font-bold text-murzak-ink dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-murzak-accent"
                  />
                </div>
                <p className="text-micro font-bold text-slate-500 dark:text-slate-400 leading-relaxed">
                  We'll send you the nameservers or DNS records to add at your registrar, then verify it once they propagate.
                </p>
                {err && <ErrorBanner text={err} />}
                <SubmitButton
                  submitting={submitting}
                  disabled={!domainNameValid}
                  label="Connect this domain"
                  onClick={() =>
                    submit(() =>
                      onConnectExternalDomain({ domainName: domainName.trim(), registrar: registrar.trim() || undefined })
                    )
                  }
                />
              </div>
            )}

            {path === "subdomain" && (
              <div className="space-y-4">
                <div>
                  <label className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">
                    Subdomain label
                  </label>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      autoFocus
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="yourbrand"
                      className="flex-1 h-12 px-4 rounded-xl bg-slate-50 dark:bg-black/5 border border-slate-200 dark:border-murzak-border text-sm font-bold text-murzak-ink dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-murzak-accent"
                    />
                    <span className="text-sm font-black text-slate-500 dark:text-slate-400 shrink-0">.murzaktech.com</span>
                  </div>
                  {label && !subdomainLabelValid && (
                    <p className="mt-2 text-micro font-bold text-red-500">Letters, numbers and hyphens only.</p>
                  )}
                </div>
                <div className="flex items-start gap-2 p-3 rounded-xl bg-murzak-accent/10 border border-murzak-accent/20">
                  <ShieldCheck className="w-4 h-4 text-murzak-accent shrink-0 mt-0.5" />
                  <p className="text-micro font-bold text-slate-600 dark:text-slate-400 leading-relaxed">
                    Free, no registration needed — this is usually ready the fastest.
                  </p>
                </div>
                {err && <ErrorBanner text={err} />}
                <SubmitButton
                  submitting={submitting}
                  disabled={!subdomainLabelValid}
                  label="Get this subdomain"
                  onClick={() => submit(() => onRequestFreeSubdomain({ requestedLabel: label.trim() }))}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ErrorBanner({ text }: { text: string }) {
  return (
    <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-500 flex items-start gap-3">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <p className="text-micro font-bold leading-relaxed">{text}</p>
    </div>
  );
}

function SubmitButton({
  submitting,
  disabled,
  label,
  onClick,
}: {
  submitting: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={submitting || disabled}
      onClick={onClick}
      className={`w-full px-5 py-3 rounded-2xl font-black text-micro uppercase transition-all flex items-center justify-center gap-2 ${
        submitting || disabled
          ? "bg-slate-100 dark:bg-black/5 text-slate-500 cursor-not-allowed"
          : "bg-murzak-accent text-murzak-ink hover:scale-[1.02]"
      }`}
    >
      {submitting ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" /> Sending…
        </>
      ) : (
        label
      )}
    </button>
  );
}
