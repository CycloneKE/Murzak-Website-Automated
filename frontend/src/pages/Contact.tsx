import React, { useEffect, useRef, useState } from "react";
import { X, Send, RefreshCw, MessageSquare, AlertCircle } from "lucide-react";
import { toUserMessage } from "../services/errors";
import { redactStatusPath } from "../utils/safeUrl";

interface ContactProps {
  isOpen: boolean;
  onClose: () => void;
  user?: {
    email?: string;
    fullName?: string;
  };
}

type SenderType = "User" | "Admin";

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

type ChatMessage = {
  sender_type: SenderType;
  sender: string;
  message: string;
  sent_at?: string;
  creation?: string;
  attachments?: string;
};

type ThreadDoc = {
  name: string;
  status?: string;
  last_message_at?: string;
  messages?: ChatMessage[];
};

const Contact: React.FC<ContactProps> = ({ isOpen, onClose, user }) => {
  const [threadId, setThreadId] = useState<string>("");
  const [thread, setThread] = useState<ThreadDoc | null>(null);
  const email = user?.email || "";

  const [draft, setDraft] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const pollRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string>("");
  const [uploadedName, setUploadedName] = useState<string>("");


  const stopPolling = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  };

  const validateDraft = () => {
    const newErrors: Record<string, string> = {};
    if (!draft.trim()) newErrors.draft = "Type a message to send";
    else if (draft.trim().length < 2) newErrors.draft = "Message is too short";
    setErrors((prev) => ({ ...prev, ...newErrors }));
    return Object.keys(newErrors).length === 0;
  };

  const fetchThread = async (id: string) => {
    const res = await fetch(`/api/portal/requests/${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to load conversation");

    // Defensive: ensure messages is always an array
    const doc = data?.data || null;
    doc.messages = Array.isArray(doc?.messages) ? doc.messages : [];

    setThread(doc);
    scrollToBottom();
  };

  const startPolling = (id: string) => {
    stopPolling();
    pollRef.current = window.setInterval(() => {
      fetchThread(id).catch(() => {});
    }, 4000);
  };

  const getOrCreateThreadIfExists = async () => {
    const email = user?.email || "";

    if (!email) {
      setErrors({ submit: "Your session is missing user info. Please refresh or log in again." });
    return;
   }

    const res = await fetch(`/api/portal/requests/my-thread?email=${encodeURIComponent(email)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to locate thread");

    if (data?.id) {
      setThreadId(data.id);
      await fetchThread(data.id);
      startPolling(data.id);
    }
  };

  const createThreadAndSendFirst = async (attachmentUrl?: string) => {
    const email = user?.email || "";

    if (!email) {
      setErrors({ submit: "Your session is missing user info. Please refresh or log in again." });
      return;
    }
    const res = await fetch("/api/portal/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email.trim(),
        message: draft.trim(),
        attachments: attachmentUrl || "",
        pageUrl: redactStatusPath(window.location.href),
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to create request thread");

    const id = data?.id as string;
    if (!id) throw new Error("Thread created but no ID returned");

    setThreadId(id);
    await fetchThread(id);
    startPolling(id);
  };

  const sendMessage = async (id: string, attachmentUrl?: string) => {
    const res = await fetch(`/api/portal/requests/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderType: "User",
        sender: user.email.trim(),
        message: draft.trim(),
        attachments: attachmentUrl || "",
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to send message");

    await fetchThread(id);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateDraft()) return;

    setIsSubmitting(true);
    setErrors((prev) => ({ ...prev, submit: "" }));

    try {
      // Use the already uploaded URL (if any)
      const attachmentToSend = uploadedUrl || "";

      if (!threadId) {
        await createThreadAndSendFirst(attachmentToSend);
      } else {
        await sendMessage(threadId, attachmentToSend);
      }

      // clear composer + attachment
      setDraft("");
      setFile(null);
      setUploadedUrl("");
      setUploadedName("");
      setErrors((prev) => ({ ...prev, draft: "" }));
    } catch (err: any) {
      setErrors((prev) => ({...prev, submit: toUserMessage(err, "Couldn't send your message. Please try again."),
    }));
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      stopPolling();
      setThread(null);
      setThreadId("");
      setDraft("");
      setErrors({});
      return;
    }

    document.body.style.overflow = "hidden";

    const email = user?.email || "";
    if (!email) {
      setErrors({ submit: "Your session is missing user info. Please refresh or log in again." });
      return;
    }

    // load existing thread if any
    getOrCreateThreadIfExists().catch(() => {});

    return () => {
      document.body.style.overflow = "unset";
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [thread?.messages?.length, isOpen]);

  if (!isOpen) return null;

  const messages = thread?.messages || [];

  const inputBase =
    "w-full bg-p-panel-2 border rounded-md px-4 py-2.5 sm:py-3 text-sm font-medium text-p-text placeholder:text-p-muted focus:outline-hidden focus:ring-2 focus:ring-p-accent/40 transition-all";

  const inputClasses = (key: string) =>
    `${inputBase} ${errors[key] ? "border-p-danger/40" : "border-p-border "}`;

  const labelClasses =
    "block text-xs font-semibold text-p-muted mb-2 ml-1";

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center p-3 sm:p-6">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      <div className="relative w-full max-w-4xl bg-p-panel rounded-lg sm:rounded-lg sm:shadow-3xl overflow-hidden border border-p-border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 sm:px-8 sm:py-6
          border-b border-p-border bg-p-panel-2">
          <div className="flex items-center gap-3">
            <div className="p-2.5 sm:p-3 rounded-md sm:rounded-lg bg-p-accent-soft text-p-accent-text">
              <MessageSquare className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-p-text">
                Chat with support
              </h3>
              <p className="text-xs font-semibold text-p-muted mt-1">
                Signed in as {email}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-p-muted hover:text-p-text transition-colors"
            type="button"
          >
            <X className="w-5 h-5 sm:w-[22px] sm:h-[22px]" />
          </button>
        </div>

        {/* Chat */}
        <div className="p-5 sm:p-8">
          <div className="h-[52vh] sm:h-[380px] md:h-[460px] max-h-[60vh] overflow-y-auto pr-2 space-y-4">
            {messages.length === 0 ? (
              <div className="text-center py-12 sm:py-16 bg-p-panel-2 rounded-lg sm:rounded-lg border border-dashed border-p-border ">
                <p className="text-xs font-semibold text-p-muted ">
                  No messages yet. Start the conversation below.
                </p>
              </div>
            ) : (
              messages.map((m, idx) => {
                const isUser = m.sender_type === "User";
                const stamp = m.sent_at || m.creation;
                return (
                  <div key={`${idx}-${stamp || "t"}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[92%] sm:max-w-[85%] rounded-lg sm:rounded-lg px-4 py-3 sm:px-5 sm:py-4 border ${
                        isUser
                          ? "bg-p-accent-soft text-p-text border-p-accent/40"
                          : "bg-p-panel-2 text-p-text border-p-border"
                      }`}
                    >
                      <p className="text-[13px] sm:text-sm sm:leading-(--text-sm--line-height) font-bold leading-relaxed whitespace-pre-wrap wrap-break-word">{m.message}</p>
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
                          {isUser ? "You" : "Admin"}
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

          {errors.submit && (
            <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-p-danger">
              <AlertCircle className="w-4 h-4" />
              {errors.submit}
            </div>
          )}

          <form onSubmit={handleSend} className="mt-4 flex gap-3 items-center">
            <div className="grow min-w-0">
              <label className={labelClasses}>Message</label>
              {(uploading || uploadedUrl) && (
                <div className="mb-3 flex items-center justify-between rounded-md border border-p-border bg-p-panel-2 px-4 py-3">
                  <div className="text-xs font-semibold text-p-muted ">
                    {uploading ? "Uploading..." : "Attachment ready"}
                    {!uploading && uploadedName ? `: ${uploadedName}` : ""}
                  </div>

                  {!uploading && (
                    <button
                      type="button"
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
                className={inputClasses("draft")}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Describe your issue, what you tried, and what you need help with..."
              />
              {errors.draft && (
                <p className="text-xs text-p-danger font-medium mt-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {errors.draft}
                </p>
              )}
            </div>

            <input type="file" className="hidden" id="attach"
              onChange={async (e) => {
              const f = e.target.files?.[0] || null;

              // reset any prior attachment state
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
                setErrors((prev) => ({ ...prev, submit: toUserMessage(err, "Upload failed") }));
                setFile(null);
              } finally {
                setUploading(false);

                // allow re-selecting the same file again later
                e.currentTarget.value = "";
              }
            }}/>

            <div className="flex flex-col justify-center gap-2 self-center">
              <label htmlFor="attach"
                className="h-10 sm:h-11 min-w-[96px] sm:min-w-[108px] inline-flex items-center justify-center text-center leading-none px-4 rounded-md
                  border border-p-border bg-p-panel-2 
                  text-xs sm:text-xs font-semibold cursor-pointer select-none
                  hover:border-p-accent hover:bg-p-accent-soft transition">
                {uploading ? "Uploading..." : uploadedUrl ? "Attached" : "Attach"}
              </label>

              <button type="submit"
                disabled={isSubmitting}
                className="h-10 sm:h-11 min-w-[96px] sm:min-w-[108px] bg-p-accent text-p-accent-fg font-semibold px-4 rounded-md
                   transition-all inline-flex items-center justify-center gap-2 disabled:opacity-70">
                {isSubmitting ? <RefreshCw className="animate-spin w-4 h-4" /> : <Send className="w-4 h-4" />}
                <span className="text-xs sm:text-xs ">Send</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Contact;
