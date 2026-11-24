import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, MessageSquare, RefreshCw, Search, Send } from "lucide-react";
import {
  adminGetThread,
  adminListThreads,
  adminMarkRead,
  adminReply,
  adminApproveTerminalAccess,
  adminApproveResourceAdmin,
  ChatMessage,
  ThreadDoc,
  ThreadSummary,
} from "../../services/adminChat";
import { toUserMessage } from "../../services/errors";

function fmtTime(ts?: string) {
  if (!ts) return "";

  // If it's "YYYY-MM-DD HH:mm:ss", treat as UTC by appending Z
  const iso = ts.includes("T")
    ? ts
    : ts.replace(" ", "T") + "Z";

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ts;

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function statusClasses(status?: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("waiting on admin")) return "bg-p-danger-soft text-p-danger border-p-danger/40";
  if (s.includes("waiting on user")) return "bg-p-warning-soft text-p-warning border-p-warning/40";
  if (s.includes("new")) return "bg-p-info-soft text-p-info border-p-info/40";
  if (s.includes("resolved")) return "bg-p-success-soft text-p-success border-p-success/40";
  return "bg-slate-500/10 text-p-muted border-p-border";
}


function labelFromThread(t: ThreadSummary) {
  const name = (t.full_name || "").trim();
  const email = (t.email || "").trim();
  return name || email || t.name;
}

/** Threads staff still owe a reply on — mirrors ADMIN_PENDING_STATUSES server-side. */
function isPending(t: ThreadSummary) {
  const s = (t.status || "").toLowerCase();
  return s === "new" || s === "waiting on admin";
}

/**
 * Unread first, then still-pending, then newest. Without this the inbox is
 * ordered purely by recency and a thread that has been waiting for days sinks
 * below chatter that needs no reply.
 */
function inboxOrder(a: ThreadSummary, b: ThreadSummary) {
  const rank = (t: ThreadSummary) => (t.unread ? 0 : isPending(t) ? 1 : 2);
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  const stamp = (t: ThreadSummary) => t.last_message_at || t.modified || "";
  return stamp(b).localeCompare(stamp(a));
}

const POLL_MS = 4000;

type AdminInboxProps = {
  /** Lets the shell (AdminTabs → Portal sidebar) mirror the badge count. */
  onUnreadChange?: (count: number) => void;
};

const AdminInbox: React.FC<AdminInboxProps> = ({ onUnreadChange }) => {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [threadDoc, setThreadDoc] = useState<ThreadDoc | null>(null);

  const [query, setQuery] = useState("");
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);

  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>("");
  const [approvingTerminal, setApprovingTerminal] = useState(false);
  const [terminalApproveNote, setTerminalApproveNote] = useState("");
  const [approvingResourceAdmin, setApprovingResourceAdmin] = useState(false);
  const [resourceAdminApproveNote, setResourceAdminApproveNote] = useState("");

  const pollRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState("");
  const [uploadedName, setUploadedName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const stopPolling = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  };

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q
      ? threads
      : threads.filter((t) => {
          const hay = `${t.name} ${t.email || ""} ${t.full_name || ""} ${t.company_name || ""} ${t.status || ""}`
            .toLowerCase();
          return hay.includes(q);
        });
    return [...base].sort(inboxOrder);
  }, [threads, query]);

  const unreadCount = useMemo(() => threads.filter((t) => t.unread).length, [threads]);

  useEffect(() => {
    onUnreadChange?.(unreadCount);
  }, [unreadCount, onUnreadChange]);

  const loadThreads = async () => {
    setLoadingThreads(true);
    setError("");
    try {
      const data = await adminListThreads();
      setThreads(data);
      // auto-select first thread if none selected — after the same ordering the
      // list renders, so it lands on the thread that actually needs attention.
      if (!selectedId) {
        const first = [...data].sort(inboxOrder)[0];
        if (first?.name) setSelectedId(first.name);
      }
    } catch (e: any) {
      setError(toUserMessage(e, "Failed to load threads."));
    } finally {
      setLoadingThreads(false);
    }
  };

  const loadThread = async (id: string) => {
    if (!id) return;
    setLoadingThread(true);
    setError("");
    setTerminalApproveNote("");
    try {
      const doc = await adminGetThread(id);
      setThreadDoc(doc);
      scrollToBottom();

      // Opening a thread IS reading it — stamp it so the badge clears. Done
      // optimistically in local state too so the dot disappears immediately
      // rather than waiting for the next poll.
      await adminMarkRead(id).catch(() => {});
      setThreads((prev) => prev.map((t) => (t.name === id ? { ...t, unread: false } : t)));
    } catch (e: any) {
      setError(toUserMessage(e, "Failed to load thread."));
    } finally {
      setLoadingThread(false);
    }
  };

  const startPolling = (id: string) => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      // refresh inbox list + thread
      try {
        const data = await adminListThreads();
        setThreads(data);
      } catch {}
      if (id) {
        adminGetThread(id)
          .then((doc) => {
            setThreadDoc(doc);
          })
          .catch(() => {});
      }
    }, POLL_MS);
  };

  useEffect(() => {
    loadThreads();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    loadThread(selectedId);
    startPolling(selectedId);
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    scrollToBottom();
  }, [threadDoc?.messages?.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedId) return;

    const msg = draft.trim();
    const attachmentToSend = uploadedUrl || "";

    // Require either a message or an attachment
    if (!msg && !attachmentToSend) return;

    // Don’t allow send while upload is still in progress
    if (uploading) {
      setError("Please wait for the file upload to finish.");
      return;
    }

    setSending(true);
    setError("");

    try {
      await adminReply(selectedId, msg, attachmentToSend);

      // reset composer
      setDraft("");

      // reset attachment state
      setUploadedUrl("");
      setUploadedName("");
      setFile(null);

      // refresh thread + list
      const doc = await adminGetThread(selectedId);
      setThreadDoc(doc);
      await loadThreads();
      scrollToBottom();
    } catch (e: any) {
      setError(toUserMessage(e, "Failed to send reply."));
    } finally {
      setSending(false);
    }
  };

  const isDeveloperAccessThread = (t: ThreadDoc | null) =>
    !!t?.subject && t.subject.startsWith("Developer Access Request:");

  const handleApproveTerminalAccess = async () => {
    if (!threadDoc?.portal_user) return;
    setApprovingTerminal(true);
    setTerminalApproveNote("");
    try {
      await adminApproveTerminalAccess(threadDoc.portal_user);
      setTerminalApproveNote("Developer access approved — the customer can now accept the disclosure and open a session.");
    } catch (e: any) {
      setTerminalApproveNote(toUserMessage(e, "Failed to approve developer access."));
    } finally {
      setApprovingTerminal(false);
    }
  };

  const isResourceAdminThread = (t: ThreadDoc | null) =>
    !!t?.subject && t.subject.startsWith("Resource Admin Access Request:");

  const handleApproveResourceAdmin = async () => {
    if (!threadDoc?.portal_user) return;
    setApprovingResourceAdmin(true);
    setResourceAdminApproveNote("");
    try {
      await adminApproveResourceAdmin(threadDoc.portal_user);
      setResourceAdminApproveNote("Advanced controls approved — the customer can now accept the disclosure and manage this service directly.");
    } catch (e: any) {
      setResourceAdminApproveNote(toUserMessage(e, "Failed to approve advanced controls."));
    } finally {
      setApprovingResourceAdmin(false);
    }
  };

  const messages: ChatMessage[] = threadDoc?.messages || [];
  const threadTitle = threadDoc ? labelFromThread(threadDoc) : "Select a thread";
  const threadMeta = threadDoc
    ? `${threadDoc.company_name || "—"} • ${threadDoc.email || "—"}`
    : "";

  return (
    <div className="w-full">
      <div className="mb-8">
        <h2 className="text-2xl sm:text-3xl font-semibold ">Admin Inbox</h2>
        <p className="text-xs font-semibold text-p-muted mt-2">
          View portal conversations and reply per user thread.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left: Threads */}
        <div className="lg:col-span-2 bg-p-panel border border-p-border rounded-lg sm:rounded-lg overflow-hidden">
          <div className="p-6 border-b border-p-border ">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-p-accent-soft text-p-accent-text">
                <MessageSquare className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
              </div>
              <div className="grow">
                <p className="text-xs font-semibold text-p-muted ">
                  Threads
                </p>
                <p className="text-sm font-semibold text-p-text ">
                  {loadingThreads
                    ? "Loading..."
                    : unreadCount > 0
                      ? `${unreadCount} unread · ${threads.length} total`
                      : `${threads.length} total`}
                </p>
              </div>
              <button
                onClick={loadThreads}
                className="p-2.5 sm:p-3 rounded-md sm:rounded-lg hover:bg-p-accent-soft text-p-muted hover:text-p-accent-text transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-p-accent/40"
                title="Refresh"
                aria-label="Refresh threads"
                type="button"
              >
                <RefreshCw className={`w-4 h-4 sm:w-[18px] sm:h-[18px] ${loadingThreads ? "animate-spin" : ""}`} />
              </button>
            </div>

            <div className="mt-4 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-p-muted w-4 h-4" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email, company..."
                className="w-full bg-p-panel-2 border border-p-border rounded-md sm:rounded-lg pl-11 pr-4 py-2.5 sm:py-3
                            text-sm font-medium text-p-text placeholder:text-p-muted focus:outline-hidden focus:ring-2 focus:ring-p-accent/40"/>
            </div>
          </div>

          <div className="max-h-[520px] overflow-y-auto">
            {filteredThreads.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-xs font-semibold text-p-muted ">
                  No threads found.
                </p>
              </div>
            ) : (
              filteredThreads.map((t) => {
                const active = t.name === selectedId;
                return (
                  <button
                    key={t.name}
                    onClick={() => setSelectedId(t.name)}
                    className={`w-full text-left p-4 sm:p-6 border-b border-p-border transition-all ${
                      active ? 
                      "bg-p-accent-soft" : "hover:bg-p-panel-2 "
                    }`}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold text-p-text ">
                          {t.unread && (
                            <span
                              className="w-2 h-2 shrink-0 rounded-full bg-red-600"
                              aria-label="Unread"
                            />
                          )}
                          <span className="truncate">{labelFromThread(t)}</span>
                        </p>
                        <p className="text-xs font-semibold text-p-muted mt-1 truncate">
                          {(t.company_name || "—")} • {(t.email || "—")}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold ${statusClasses(t.status)}`}>
                          {t.status || "—"}
                        </span>
                        <p className="text-xs font-medium text-p-muted mt-1">
                          {fmtTime(t.last_message_at || t.modified)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Thread */}
        <div className="lg:col-span-3 bg-p-panel border border-p-border rounded-lg sm:rounded-lg overflow-hidden">
          <div className="p-6 border-b border-p-border ">
            <div className="flex items-center justify-between gap-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-p-muted ">
                  Active Thread
                </p>
                <p className="text-base sm:text-lg font-semibold text-p-text truncate">
                  {threadTitle}
                </p>
                <p className="text-xs font-semibold text-p-muted mt-1 truncate">
                  {threadMeta}
                </p>
              </div>

              <button
                onClick={() => selectedId && loadThread(selectedId)}
                className="p-3 rounded-lg hover:bg-p-accent-soft text-p-muted hover:text-p-accent-text transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-p-accent/40"
                title="Refresh thread"
                aria-label="Refresh thread"
                type="button"
              >
                <RefreshCw size={18} className={loadingThread ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          {isDeveloperAccessThread(threadDoc) && (
            <div className="px-6 py-4 border-b border-p-border bg-p-accent-soft flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold text-p-muted ">
                Developer access request
              </p>
              <button
                type="button"
                onClick={handleApproveTerminalAccess}
                disabled={approvingTerminal || !threadDoc?.portal_user}
                className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-p-accent text-p-accent-fg text-xs font-semibold transition disabled:opacity-60"
              >
                {approvingTerminal ? "Approving..." : "Approve Developer Access"}
              </button>
            </div>
          )}
          {terminalApproveNote && (
            <div className="px-6 pt-4 text-xs font-semibold text-p-accent-text">
              {terminalApproveNote}
            </div>
          )}
          {isResourceAdminThread(threadDoc) && (
            <div className="px-6 py-4 border-b border-p-border bg-p-accent-soft flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold text-p-muted ">
                Advanced controls request
              </p>
              <button
                type="button"
                onClick={handleApproveResourceAdmin}
                disabled={approvingResourceAdmin || !threadDoc?.portal_user}
                className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-p-accent text-p-accent-fg text-xs font-semibold transition disabled:opacity-60"
              >
                {approvingResourceAdmin ? "Approving..." : "Approve Advanced Controls"}
              </button>
            </div>
          )}
          {resourceAdminApproveNote && (
            <div className="px-6 pt-4 text-xs font-semibold text-p-accent-text">
              {resourceAdminApproveNote}
            </div>
          )}

          <div className="p-6">
            {error && (
              <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-p-danger">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}

            <div className="h-[52vh] sm:h-[420px] max-h-[60vh] overflow-y-auto pr-2 space-y-4">
              {!selectedId ? (
                <div className="text-center py-16 bg-p-panel-2 rounded-lg border border-dashed border-p-border ">
                  <p className="text-xs font-semibold text-p-muted ">
                    Select a thread on the left to view messages.
                  </p>
                </div>
              ) : loadingThread ? (
                <div className="text-center py-16">
                  <p className="text-xs font-semibold text-p-muted ">
                    Loading conversation...
                  </p>
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-16 bg-p-panel-2 rounded-lg border border-dashed border-p-border ">
                  <p className="text-xs font-semibold text-p-muted ">
                    No messages yet in this thread.
                  </p>
                </div>
              ) : (
                messages.map((m, idx) => {
                  const isAdmin = m.sender_type === "Admin";
                  const stamp = m.sent_at || m.creation;
                  return (
                    <div key={`${idx}-${stamp || "t"}`} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[92%] sm:max-w-[85%] rounded-lg sm:rounded-lg px-4 py-3 sm:px-5 sm:py-4 border ${
                          isAdmin
                            ? "bg-p-accent text-p-accent-fg border-p-accent/40"
                            : "bg-p-panel-2 text-p-text border-p-border "
                        }`}
                      >
                        <p className="text-[13px] sm:text-sm sm:leading-(--text-sm--line-height) font-bold leading-relaxed whitespace-pre-wrap wrap-break-word">
                          {m.message}
                        </p>
                        {m.attachments && (
                          <a href={`/api/portal/files?url=${encodeURIComponent(m.attachments)}`} 
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-flex text-xs sm:text-xs font-semibold underline opacity-80">
                              View attachment
                          </a>
                        )}

                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold opacity-70">
                            {isAdmin ? "Admin" : (m.sender || "User")}
                          </span>
                          <span className="text-xs font-medium opacity-60">
                            {fmtTime(stamp)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              <div ref={bottomRef} />
            </div>

            <form onSubmit={handleSend} className="mt-5 flex flex-col sm:flex-row gap-3 items-stretch">
              <div className="grow">
                <label className="block text-xs font-semibold text-p-muted mb-2 ml-1">
                  Reply
                </label>

                {(uploading || uploadedUrl) && (
                  <div className="mb-3 flex items-center justify-between rounded-md border border-p-border bg-p-panel-2 px-4 py-3">
                    <div className="text-xs sm:text-xs font-semibold text-p-muted ">
                      {uploading ? "Uploading..." : `Attachment ready: ${uploadedName}`}
                    </div>

                  {!uploading && (
                    <button type="button"
                      onClick={() => {
                        setFile(null);
                        setUploadedUrl("");
                        setUploadedName("");
                      }}
                      className="text-xs font-semibold text-p-accent-text hover:opacity-80">
                        Remove
                    </button>
                  )}
                </div>
              )}

                <textarea
                  rows={3}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Reply to this user..."
                  className="w-full bg-p-panel-2 border border-p-border rounded-md px-4 py-2.5 sm:py-3 text-sm font-medium text-p-text placeholder:text-p-muted focus:outline-hidden focus:ring-2 focus:ring-p-accent/40 transition-all resize-none"
                />
              </div>

              <input type="file" className="hidden" id="admin-attach"
                onChange={async (e) => {
                  const f = e.target.files?.[0] || null;
                  setFile(f);
                  setUploadedUrl("");
                  setUploadedName("");

                  if (!f) return;

                  try {
                    setUploading(true);
                    const fd = new FormData();
                    fd.append("file", f);

                    const upRes = await fetch("/api/portal/upload", {
                      method: "POST",
                      credentials: "include",
                      body: fd,
                    });

                    const upData = await upRes.json().catch(() => ({}));
                    if (!upRes.ok) throw new Error(upData?.error || "Upload failed");

                    setUploadedUrl(upData.file_url || "");
                    setUploadedName(f.name);
                  } catch (err: any) {
                    setError(toUserMessage(err, "Upload failed"));
                    setFile(null);
                  } finally {
                    setUploading(false);
                    e.currentTarget.value = "";
                  }
                }}
              />
              <div className="flex flex-col justify-center gap-2 self-center">
                <label htmlFor="admin-attach"
                  className="h-10 sm:h-11 min-w-[96px] sm:min-w-[108px] inline-flex items-center justify-center text-center leading-none px-4 rounded-md
                    border border-p-border bg-p-panel-2 
                    text-xs sm:text-xs font-semibold cursor-pointer select-none
                    hover:border-p-accent hover:bg-p-accent-soft transition">
                  {uploading ? "Uploading..." : uploadedUrl ? "Attached" : "Attach"}
                </label>

                <button type="submit"
                  disabled={isSubmitting || !selectedId || sending || !draft.trim()}
                  className="h-10 sm:h-11 min-w-[96px] sm:min-w-[108px] bg-p-accent text-p-accent-fg font-semibold px-4 rounded-md
                     transition-all inline-flex items-center justify-center gap-2 disabled:opacity-70">
                  {isSubmitting ? <RefreshCw className="animate-spin w-4 h-4" /> : <Send className="w-4 h-4" />}
                  <span className="text-xs sm:text-xs ">Send</span>
                </button>
              </div>              
            </form>
            <p className="mt-3 text-xs font-semibold text-p-muted ">
              Tip: statuses update automatically when you reply.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminInbox;
