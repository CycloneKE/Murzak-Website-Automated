import React, { useMemo, useState } from "react";
import { ExternalLink, Smartphone } from "lucide-react";
import { encodeQr, qrPath } from "../../utils/qr";
import { SUPPORT_EMAIL } from "../../config/contact";

/**
 * "Add to my phone": plain steps for iPhone, Android and Outlook, plus a QR
 * code that opens the webmail on a phone. The QR encodes the webmail address
 * ONLY. It never carries a profile, an account name or a password, so
 * scanning it cannot hand anything over.
 */

const MUTED = "text-slate-600 dark:text-slate-400";

type Platform = "iphone" | "android" | "outlook";
const PLATFORMS: Array<{ id: Platform; label: string }> = [
  { id: "iphone", label: "iPhone" },
  { id: "android", label: "Android" },
  { id: "outlook", label: "Outlook" },
];

interface Props {
  mailboxes: Array<{ address: string; passwordSet: boolean }>;
  webmailUrl: string;
}

function QrCode({ url }: { url: string }) {
  const svg = useMemo(() => {
    try {
      const m = encodeQr(url);
      return { size: m.length, d: qrPath(m) };
    } catch {
      return null; // address too long for the tiny encoder: show the link only
    }
  }, [url]);
  if (!svg) return null;
  const quiet = 4;
  const box = svg.size + quiet * 2;
  return (
    <svg
      role="img"
      aria-label="QR code that opens your webmail"
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      className="w-40 h-40 shrink-0 rounded-xl bg-white p-0"
      shapeRendering="crispEdges"
    >
      <rect x={-quiet} y={-quiet} width={box} height={box} fill="#ffffff" />
      <path d={svg.d} fill="#0b1220" />
    </svg>
  );
}

function Steps({ platform, address }: { platform: Platform; address: string }) {
  const addr = <strong className="font-black text-murzak-ink dark:text-slate-100 break-all">{address}</strong>;
  const lead = (
    <p className={`text-sm font-semibold ${MUTED}`}>
      Our setup is automatic, so your phone or app usually finds the server settings by itself. You normally only type your address and your password.
    </p>
  );
  if (platform === "iphone") {
    return (
      <div className="space-y-3">
        {lead}
        <ol className={`list-decimal pl-5 space-y-1.5 text-sm font-semibold ${MUTED}`}>
          <li>Open <strong>Settings</strong>, then <strong>Mail</strong>, then <strong>Accounts</strong>.</li>
          <li>Tap <strong>Add Account</strong>, then <strong>Other</strong>, then <strong>Add Mail Account</strong>.</li>
          <li>Type your name, {addr}, your password and a short description such as "Work".</li>
          <li>Tap <strong>Next</strong> and keep <strong>Mail</strong> switched on, then tap <strong>Save</strong>.</li>
        </ol>
      </div>
    );
  }
  if (platform === "android") {
    return (
      <div className="space-y-3">
        {lead}
        <ol className={`list-decimal pl-5 space-y-1.5 text-sm font-semibold ${MUTED}`}>
          <li>Open the <strong>Gmail</strong> app and tap your picture at the top right.</li>
          <li>Tap <strong>Add another account</strong>, then choose <strong>Other</strong>.</li>
          <li>Type {addr} and tap <strong>Next</strong>.</li>
          <li>Choose <strong>Personal (IMAP)</strong>, type your password and tap <strong>Next</strong>.</li>
          <li>Follow the last prompts to finish. Your new mailbox then appears in the Gmail menu.</li>
        </ol>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {lead}
      <ol className={`list-decimal pl-5 space-y-1.5 text-sm font-semibold ${MUTED}`}>
        <li>Open <strong>Outlook</strong> and choose <strong>Add account</strong> (on a computer: <strong>File</strong>, then <strong>Add Account</strong>).</li>
        <li>Type {addr} and tap <strong>Connect</strong> or <strong>Continue</strong>.</li>
        <li>If it asks what kind of account this is, choose <strong>IMAP</strong>.</li>
        <li>Type your password and finish. Outlook finds the rest from your address.</li>
      </ol>
    </div>
  );
}

const PhoneSetupCard: React.FC<Props> = ({ mailboxes, webmailUrl }) => {
  const [platform, setPlatform] = useState<Platform>("iphone");
  const [pick, setPick] = useState(0);
  if (!mailboxes.length) return null;
  const current = mailboxes[Math.min(pick, mailboxes.length - 1)];
  const safeUrl = /^https:\/\//i.test(webmailUrl) ? webmailUrl : "";

  return (
    <section id="add-to-phone" className="mt-8 rounded-3xl glass-card p-5 sm:p-6 scroll-mt-28" aria-labelledby="add-to-phone-heading">
      <h3 id="add-to-phone-heading" className="font-black text-murzak-ink dark:text-slate-100 flex items-center gap-2">
        <Smartphone size={18} aria-hidden="true" /> Add to my phone
      </h3>
      <p className={`mt-1 text-sm font-semibold ${MUTED}`}>
        Read and send from your phone as well. Choose your phone or app and follow the steps. We never show your password here and the code below never contains it.
      </p>

      {mailboxes.length > 1 && (
        <div className="mt-4">
          <label htmlFor="phone-mailbox" className="block text-label font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 mb-1.5">
            Which mailbox
          </label>
          <select
            id="phone-mailbox"
            value={pick}
            onChange={(e) => setPick(Number(e.target.value))}
            className="w-full min-h-[44px] rounded-2xl px-4 py-2.5 font-bold bg-white/70 dark:bg-white/5 border border-slate-300 dark:border-murzak-border text-murzak-ink dark:text-slate-100"
          >
            {mailboxes.map((m, i) => <option key={m.address} value={i}>{m.address}</option>)}
          </select>
        </div>
      )}

      {!current.passwordSet && (
        <p role="status" className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-bold text-amber-800 dark:text-amber-300">
          Set a password for {current.address} first. You will need it in these steps.
        </p>
      )}

      <div role="tablist" aria-label="Phone or app" className="mt-4 flex flex-wrap gap-2">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            id={`phone-tab-${p.id}`}
            type="button"
            role="tab"
            aria-selected={platform === p.id}
            aria-controls="phone-panel"
            onClick={() => setPlatform(p.id)}
            className={`min-h-[44px] px-5 rounded-2xl font-black text-sm border ${
              platform === p.id
                ? "bg-murzak-accent text-murzak-ink border-murzak-accent"
                : "border-slate-300 dark:border-murzak-border text-murzak-ink dark:text-slate-100 hover:border-murzak-accent"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div id="phone-panel" role="tabpanel" aria-labelledby={`phone-tab-${platform}`} className="mt-4">
        <Steps platform={platform} address={current.address} />
      </div>

      {safeUrl && (
        <div className="mt-6 pt-5 border-t border-slate-200 dark:border-murzak-border flex flex-col sm:flex-row items-start gap-4">
          <QrCode url={safeUrl} />
          <div className="min-w-0">
            <p className="font-black text-murzak-ink dark:text-slate-100">Or just open webmail on your phone</p>
            <p className={`mt-1 text-sm font-semibold ${MUTED}`}>
              Point your phone camera at the code to open your webmail, then sign in with {current.address} and your password. The code only contains the webmail address.
            </p>
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 min-h-[44px] text-sm font-black text-sky-700 dark:text-murzak-accent underline break-all"
            >
              {safeUrl.replace(/^https:\/\//i, "")} <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
        </div>
      )}

      <p className={`mt-5 text-sm font-semibold ${MUTED}`}>
        Stuck? Write to <a className="font-black underline text-sky-700 dark:text-murzak-accent" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we will help.
      </p>
    </section>
  );
};

export default PhoneSetupCard;
