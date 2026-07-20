import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, MessageSquare, RefreshCw, Search, Send } from "lucide-react";
import {
  adminGetThread,
  adminListThreads,
  adminReply,
  adminApproveTerminalAccess,
  ChatMessage,
  ThreadDoc,
  ThreadSummary,
} from "../../services/adminChat";

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
  if (s.includes("waiting on admin")) return "bg-red-500/15 text-red-400 border-red-500/20";
  if (s.includes("waiting on user")) return "bg-amber-500/15 text-amber-300 border-amber-500/20";
  if (s.includes("new")) return "bg-cyan-500/15 text-cyan-300 border-cyan-500/20";
  if (s.includes("resolved")) return "bg-emerald-500/15 text-emerald-300 border-emerald-500/20";
  return "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-murzak-border";
}


function labelFromThread(t: ThreadSummary) {
  const name = (t.full_name || "").trim();
  const email = (t.email || "").trim();
  return name || email || t.name;
}

const POLL_MS = 4000;

const AdminInbox: React.FC = () => {
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
    if (!q) return threads;
    return threads.filter((t) => {
      const hay = `${t.name} ${t.email || ""} ${t.full_name || ""} ${t.company_name || ""} ${t.status || ""}`
        .toLowerCase();
      return hay.includes(q);
    });
  }, [threads, query]);

  const loadThreads = async () => {
    setLoadingThreads(true);
    setError("");
    try {
      const data = await adminListThreads();
      setThreads(data);
      // auto-select first thread if none selected
      if (!selectedId && data?.[0]?.name) setSelectedId(data[0].name);
    } catch (e: any) {
      setError(e?.message || "Failed to load threads.");
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
    } catch (e: any) {
      setError(e?.message || "Failed to load thread.");
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
      setError(e?.message || "Failed to send reply.");
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
      setTerminalApproveNote(e?.message || "Failed to approve developer access.");
    } finally {
      setApprovingTerminal(false);
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
        <h2 className="text-2xl sm:text-3xl font-black tracking-tighter uppercase">Admin Inbox</h2>
        <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-2">
          View portal conversations and reply per user thread.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left: Threads */}
        <div className="lg:col-span-2 bg-white/80 dark:bg-white/60 backdrop-blur-md sm:backdrop-blur-xl border border-slate-100 dark:border-murzak-border/50 rounded-[1.75rem] sm:rounded-[2.5rem] shadow-lg sm:shadow-xl overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-murzak-border">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-murzak-accent/10 text-murzak-accent">
                <MessageSquare className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
              </div>
              <div className="flex-grow">
                <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">
                  Threads
                </p>
                <p className="text-sm font-black text-murzak-ink dark:text-slate-100">
                  {loadingThreads ? "Loading..." : `${threads.length} total`}
                </p>
              </div>
              <button
                onClick={loadThreads}
                className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl hover:bg-murzak-accent/10 text-slate-500 hover:text-murzak-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-murzak-accent"
                title="Refresh"
                aria-label="Refresh threads"
                type="button"
              >
                <RefreshCw className={`w-4 h-4 sm:w-[18px] sm:h-[18px] ${loadingThreads ? "animate-spin" : ""}`} />
              </button>
            </div>

            <div className="mt-4 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email, company..."
                className="w-full bg-slate-50 dark:bg-black/5 border border-slate-200 dark:border-murzak-border rounded-xl sm:rounded-2xl pl-11 pr-4 py-2.5 sm:py-3
                            text-sm font-bold text-murzak-ink placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-murzak-accent"/>
            </div>
          </div>

          <div className="max-h-[520px] overflow-y-auto">
            {filteredThreads.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">
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
                    className={`w-full text-left p-4 sm:p-6 border-b border-slate-100 dark:border-murzak-border transition-all ${
                      active ? 
                      "bg-murzak-accent/10" : "hover:bg-slate-50 dark:hover:bg-black/5"
                    }`}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-murzak-ink dark:text-slate-100 truncate">
                          {labelFromThread(t)}
                        </p>
                        <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-1 truncate">
                          {(t.company_name || "—")} • {(t.email || "—")}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full border text-micro font-black uppercase ${statusClasses(t.status)}`}>
                          {t.status || "—"}
                        </span>
                        <p className="text-micro font-bold text-slate-600 dark:text-slate-400 mt-1">
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
        <div className="lg:col-span-3 bg-white/80 dark:bg-white/60 backdrop-blur-md sm:backdrop-blur-xl border border-slate-100 dark:border-murzak-border/50 rounded-[1.75rem] sm:rounded-[2.5rem] shadow-lg sm:shadow-xl overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-murzak-border">
            <div className="flex items-center justify-between gap-6">
              <div className="min-w-0">
                <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">
                  Active Thread
                </p>
                <p className="text-base sm:text-lg font-black text-murzak-ink dark:text-slate-100 truncate">
                  {threadTitle}
                </p>
                <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400 mt-1 truncate">
                  {threadMeta}
                </p>
              </div>

              <button
                onClick={() => selectedId && loadThread(selectedId)}
                className="p-3 rounded-2xl hover:bg-murzak-accent/10 text-slate-500 hover:text-murzak-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-murzak-accent"
                title="Refresh thread"
                aria-label="Refresh thread"
                type="button"
              >
                <RefreshCw size={18} className={loadingThread ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          {isDeveloperAccessThread(threadDoc) && (
            <div className="px-6 py-4 border-b border-slate-100 dark:border-murzak-border bg-murzak-accent/5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">
                Developer access request
              </p>
              <button
                type="button"
                onClick={handleApproveTerminalAccess}
                disabled={approvingTerminal || !threadDoc?.portal_user}
                className="h-9 px-4 inline-flex items-center gap-2 rounded-xl bg-murzak-accent text-murzak-ink text-micro font-black uppercase hover:scale-[1.02] transition disabled:opacity-60"
              >
                {approvingTerminal ? "Approving..." : "Approve Developer Access"}
              </button>
            </div>
          )}
          {terminalApproveNote && (
            <div className="px-6 pt-4 text-micro font-black uppercase text-murzak-accent">
              {terminalApproveNote}
            </div>
          )}

          <div className="p-6">
            {error && (
              <div className="mb-4 flex items-center gap-2 text-micro font-black uppercase text-red-500">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}

            <div className="h-[52vh] sm:h-[420px] max-h-[60vh] overflow-y-auto pr-2 space-y-4">
              {!selectedId ? (
                <div className="text-center py-16 bg-slate-50 dark:bg-black/5 rounded-3xl border border-dashed border-slate-200 dark:border-murzak-border">
                  <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">
                    Select a thread on the left to view messages.
                  </p>
                </div>
              ) : loadingThread ? (
                <div className="text-center py-16">
                  <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">
                    Loading conversation...
                  </p>
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-16 bg-slate-50 dark:bg-black/5 rounded-3xl border border-dashed border-slate-200 dark:border-murzak-border">
                  <p className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">
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
                        className={`max-w-[92%] sm:max-w-[85%] rounded-[1.25rem] sm:rounded-2xl px-4 py-3 sm:px-5 sm:py-4 border ${
                          isAdmin
                            ? "bg-murzak-accent text-murzak-ink border-murzak-accent"
                            : "bg-slate-50 dark:bg-black/5 text-murzak-ink dark:text-slate-100 border-slate-200 dark:border-murzak-border"
                        }`}
                      >
                        <p className="text-[13px] sm:text-sm font-bold leading-relaxed whitespace-pre-wrap break-words">
                          {m.message}
                        </p>
                        {m.attachments && (
                          <a href={`/api/portal/files?url=${encodeURIComponent(m.attachments)}`} 
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-flex text-micro sm:text-micro font-black uppercase underline opacity-80">
                              View attachment
                          </a>
                        )}

                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span className="text-micro font-black uppercase opacity-70">
                            {isAdmin ? "Admin" : (m.sender || "User")}
                          </span>
                          <span className="text-micro font-bold opacity-60">
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
              <div className="flex-grow">
                <label className="block text-micro font-black text-slate-600 dark:text-slate-400 uppercase mb-2 ml-1">
                  Reply
                </label>

                {(uploading || uploadedUrl) && (
                  <div className="mb-3 flex items-center justify-between rounded-xl border border-slate-200 dark:border-murzak-border bg-slate-50 dark:bg-black/5 px-4 py-3">
                    <div className="text-micro sm:text-micro font-black uppercase text-slate-600 dark:text-slate-200">
                      {uploading ? "Uploading..." : `Attachment ready: ${uploadedName}`}
                    </div>

                  {!uploading && (
                    <button type="button"
                      onClick={() => {
                        setFile(null);
                        setUploadedUrl("");
                        setUploadedName("");
                      }}
                      className="text-micro font-black uppercase text-murzak-accent hover:opacity-80">
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
                  className="w-full bg-slate-50 dark:bg-black/5 border border-slate-200 dark:border-murzak-border rounded-xl px-4 py-2.5 sm:py-3 text-sm font-bold text-murzak-ink dark:text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-murzak-accent transition-all resize-none"
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
                    setError(err?.message || "Upload failed");
                    setFile(null);
                  } finally {
                    setUploading(false);
                    e.currentTarget.value = "";
                  }
                }}
              />
              <div className="flex flex-col justify-center gap-2 self-center">
                <label htmlFor="admin-attach"
                  className="h-10 sm:h-11 min-w-[96px] sm:min-w-[108px] inline-flex items-center justify-center text-center leading-none px-4 rounded-xl
                    border border-slate-200 dark:border-murzak-border bg-slate-50 dark:bg-black/5
                    text-micro sm:text-micro font-black uppercase cursor-pointer select-none
                    hover:border-murzak-accent/40 hover:bg-murzak-accent/10 dark:hover:bg-black/5 transition">
                  {uploading ? "Uploading..." : uploadedUrl ? "Attached" : "Attach"}
                </label>

                <button type="submit"
                  disabled={isSubmitting || !selectedId || sending || !draft.trim()}
                  className="h-10 sm:h-11 min-w-[96px] sm:min-w-[108px] bg-murzak-accent text-murzak-ink font-black px-4 rounded-xl
                    hover:scale-[1.01] transition-all shadow-md sm:shadow-lg inline-flex items-center justify-center gap-2 disabled:opacity-70">
                  {isSubmitting ? <RefreshCw className="animate-spin w-4 h-4" /> : <Send className="w-4 h-4" />}
                  <span className="text-micro sm:text-micro uppercase">Send</span>
                </button>
              </div>              
            </form>
            <p className="mt-3 text-micro font-black uppercase text-slate-600 dark:text-slate-400">
              Tip: statuses update automatically when you reply.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminInbox;
