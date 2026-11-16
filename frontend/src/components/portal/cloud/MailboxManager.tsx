import React, { useCallback, useEffect, useState } from "react";
import { Mail, Plus, Trash2, RefreshCw, KeyRound, ExternalLink } from "lucide-react";
import {
  fetchMailboxes,
  createMailbox,
  changeMailboxPassword,
  deleteMailbox,
  Mailbox,
  MailboxSettings,
} from "../../../services/mailboxes";
import { toUserMessage } from "../../../services/errors";

interface MailboxManagerProps {
  serviceId: string;
  isActive: boolean;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "usage unavailable";
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Mailbox self-service for the "Email Hosting" product.
 *
 * Deliberately shows the customer their real allowance: `limit` may be null
 * when the ceiling genuinely can't be read, and we render "—" rather than
 * inventing a number or implying unlimited.
 */
const MailboxManager: React.FC<MailboxManagerProps> = ({ serviceId, isActive }) => {
  const [loading, setLoading] = useState(true);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [unlimited, setUnlimited] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [webmailUrl, setWebmailUrl] = useState("");
  const [imap, setImap] = useState<MailboxSettings | null>(null);
  const [smtp, setSmtp] = useState<MailboxSettings | null>(null);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [newLocal, setNewLocal] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    return fetchMailboxes(serviceId)
      .then((data) => {
        setMailboxes(data.mailboxes);
        setLimit(data.limit);
        setUnlimited(data.unlimited);
        setCanCreate(data.canCreate);
        setWebmailUrl(data.webmailUrl);
        setImap(data.imap || null);
        setSmtp(data.smtp || null);
      })
      .catch((e: any) => setError(toUserMessage(e, "Couldn't load your mailboxes.")))
      .finally(() => setLoading(false));
  }, [serviceId]);

  useEffect(() => {
    if (isActive) load();
  }, [isActive, load]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const { mailbox } = await createMailbox(serviceId, {
        localPart: newLocal.trim().toLowerCase(),
        password: newPassword,
      });
      setNotice(`${mailbox.address || `${newLocal}@`} created.`);
      setNewLocal("");
      setNewPassword("");
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(toUserMessage(err, "Couldn't create that mailbox."));
    } finally {
      setCreating(false);
    }
  };

  const handlePassword = async (mb: Mailbox) => {
    const pw = window.prompt(`New password for ${mb.address || mb.localPart}:`);
    if (!pw) return;
    setError("");
    setBusyId(mb.id);
    try {
      await changeMailboxPassword(serviceId, mb.id, pw);
      setNotice("Password updated.");
    } catch (err: any) {
      setError(toUserMessage(err, "Couldn't update that password."));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (mb: Mailbox) => {
    const label = mb.address || `${mb.localPart}@`;
    // Deleting a mailbox destroys its mail irreversibly — make the customer
    // type the address rather than click through a generic confirm.
    const typed = window.prompt(`Deleting ${label} permanently erases its email. Type the address to confirm:`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== label.toLowerCase()) {
      setError("That didn't match. Nothing was deleted.");
      return;
    }
    setError("");
    setBusyId(mb.id);
    try {
      await deleteMailbox(serviceId, mb.id);
      setNotice(`${label} deleted.`);
      await load();
    } catch (err: any) {
      setError(toUserMessage(err, "Couldn't delete that mailbox."));
    } finally {
      setBusyId(null);
    }
  };

  if (!isActive) {
    return (
      <div className="rounded-lg bg-p-panel-2 border border-p-border p-5">
        <div className="flex items-center gap-2 mb-1">
          <Mail className="w-4 h-4 text-p-accent-text" />
          <h4 className="text-[13px] font-semibold text-p-text ">Mailboxes</h4>
        </div>
        <p className="text-[13px] font-medium text-p-muted">
          Your email isn't set up yet. We'll email you the moment it's ready.
        </p>
      </div>
    );
  }

  const allowance = unlimited ? "Unlimited" : limit === null ? "—" : String(limit);

  return (
    <div className="rounded-lg bg-p-panel-2 border border-p-border p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Mail className="w-4 h-4 text-p-accent-text" />
            <h4 className="text-[13px] font-semibold text-p-text ">Mailboxes</h4>
          </div>
          <p className="text-xs font-medium text-p-muted">
            {mailboxes.length} of {allowance} in use
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-xs font-medium text-p-muted hover:text-p-accent-text transition inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {error && <p className="text-[13px] font-medium text-p-danger mb-3">{error}</p>}
      {notice && <p className="text-[13px] font-medium text-p-success mb-3">{notice}</p>}

      {loading ? (
        <p className="text-[13px] font-medium text-p-muted mb-4">Loading…</p>
      ) : mailboxes.length === 0 ? (
        <p className="text-[13px] font-medium text-p-muted mb-4">
          No mailboxes yet. Create your first one below.
        </p>
      ) : (
        <div className="space-y-1.5 mb-4">
          {mailboxes.map((mb) => (
            <div
              key={mb.id}
              className="flex items-center gap-3 rounded-md bg-p-panel border border-p-border px-3 py-2"
            >
              <span className="text-[13px] font-medium text-p-text truncate flex-1">
                {mb.address || `${mb.localPart}@`}
              </span>
              {mb.quotaBytes > 0 && (
                <span className="text-xs font-medium text-p-muted shrink-0 hidden sm:inline">
                  {mb.usedBytes === null || mb.usedBytes === undefined
                    ? `usage unavailable · ${formatBytes(mb.quotaBytes)} quota`
                    : `${formatBytes(mb.usedBytes)} / ${formatBytes(mb.quotaBytes)}`}
                </span>
              )}
              <button
                type="button"
                onClick={() => handlePassword(mb)}
                disabled={busyId === mb.id}
                className="text-p-muted hover:text-p-accent-text transition shrink-0 disabled:opacity-50"
                aria-label={`Change password for ${mb.address || mb.localPart}`}
              >
                <KeyRound className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(mb)}
                disabled={busyId === mb.id}
                className="text-p-muted hover:text-p-danger transition shrink-0 disabled:opacity-50"
                aria-label={`Delete ${mb.address || mb.localPart}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <form onSubmit={handleCreate} className="rounded-md bg-p-panel border border-p-border p-3 mb-3 space-y-2">
          <div>
            <label htmlFor="mb-local" className="block text-xs font-medium text-p-muted mb-1">
              Mailbox name
            </label>
            <input
              id="mb-local"
              type="text"
              value={newLocal}
              onChange={(e) => setNewLocal(e.target.value)}
              placeholder="info"
              autoComplete="off"
              required
              className="w-full px-3 py-2 rounded-lg bg-p-panel-2 border border-p-border text-[13px] font-medium text-p-text "
            />
            <p className="text-xs font-medium text-p-muted mt-1">
              Letters, numbers, dots, dashes or underscores.
            </p>
          </div>
          <div>
            <label htmlFor="mb-pw" className="block text-xs font-medium text-p-muted mb-1">
              Password
            </label>
            <input
              id="mb-pw"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              className="w-full px-3 py-2 rounded-lg bg-p-panel-2 border border-p-border text-[13px] font-medium text-p-text "
            />
            <p className="text-xs font-medium text-p-muted mt-1">
              At least 8 characters, with an uppercase letter, a lowercase letter and a number.
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 rounded-md bg-p-accent text-p-accent-fg text-xs font-semibold transition disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create mailbox"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(""); }}
              className="text-xs font-medium text-p-muted hover:text-p-text transition"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          disabled={!canCreate}
          title={canCreate ? undefined : "You've used every mailbox on your plan."}
          className="px-4 py-2 rounded-md bg-p-accent text-p-accent-fg text-xs font-semibold transition disabled:opacity-60 inline-flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Add mailbox
        </button>
      )}

      {(webmailUrl || imap || smtp) && (
        <div className="mt-5 pt-4 border-t border-p-border ">
          <h5 className="text-xs font-semibold text-p-muted mb-2">Connect your mail app</h5>
          {(imap || smtp) && (
          <div className="grid sm:grid-cols-2 gap-2">
            {imap && (
              <p className="text-xs font-medium text-p-muted">
                <span className="font-medium text-p-muted ">IMAP</span> {imap.host}:{imap.port} ({imap.security})
              </p>
            )}
            {smtp && (
              <p className="text-xs font-medium text-p-muted">
                <span className="font-medium text-p-muted ">SMTP</span> {smtp.host}:{smtp.port} ({smtp.security})
              </p>
            )}
          </div>
          )}
          {webmailUrl && (
            <a
              href={webmailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-p-accent-text hover:underline"
            >
              Open webmail <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
};

export default MailboxManager;
