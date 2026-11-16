import React, { useState } from "react";
import { createPortalThread } from "../../../services/portalChat";
import { toUserMessage } from "../../../services/errors";
import { Field, PButton, Panel, inputClass } from "../ui";

interface Props {
  serviceId: string;
  serviceName: string;
}

/** Things the underlying platform can do but that are not self-service here. A person sets them up. */
const REQUEST_TOPICS = [
  { id: "storage", label: "Persistent storage", hint: "A volume that survives restarts and redeploys." },
  { id: "schedule", label: "Scheduled task", hint: "A command to run on a cron schedule." },
  { id: "webhook", label: "Webhook", hint: "Notify an external URL when this service deploys." },
];

/**
 * "Ask for more": the controls that are fulfilled by an engineer, not by a
 * button. Labelled that way on purpose so the UI never implies automation that
 * does not exist. (Environment, logs, domains and healthcheck have their own
 * sections now.)
 */
const ResourceAdminPanel: React.FC<Props> = ({ serviceId, serviceName }) => {
  const [topic, setTopic] = useState("");
  const [detail, setDetail] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const send = async () => {
    if (!topic || !detail.trim()) return;
    setSending(true);
    setError("");
    try {
      const t = REQUEST_TOPICS.find((x) => x.id === topic);
      await createPortalThread({
        subject: `${t?.label} request: ${serviceName}`,
        message: `Service: ${serviceName} (${serviceId})\nRequest type: ${t?.label}\n\n${detail.trim()}`,
      });
      setNotice("Request sent. Our team will follow up in your messages.");
      setTopic("");
      setDetail("");
    } catch (e: any) {
      setError(toUserMessage(e, "Couldn't send that request."));
    } finally {
      setSending(false);
    }
  };

  return (
    <Panel title="Ask for more" description="These are not self-service yet. A Murzak engineer sets them up for you.">
      <div className="flex flex-wrap gap-2">
        {REQUEST_TOPICS.map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.hint}
            aria-pressed={topic === t.id}
            onClick={() => { setTopic(topic === t.id ? "" : t.id); setNotice(""); }}
            className={`p-tap px-3 rounded-md text-sm border transition ${
              topic === t.id ? "bg-p-accent text-p-accent-fg border-transparent" : "border-p-border text-p-muted hover:text-p-text hover:border-p-border-strong"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {topic && (
        <div className="mt-4 space-y-3">
          <Field label="What do you need?" htmlFor="ask-more-detail">
            <textarea
              id="ask-more-detail"
              rows={3}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder={REQUEST_TOPICS.find((t) => t.id === topic)?.hint}
              className={`${inputClass} py-2`}
            />
          </Field>
          <PButton variant="primary" loading={sending} disabled={!detail.trim()} onClick={send}>
            {sending ? "Sending…" : "Send request"}
          </PButton>
        </div>
      )}
      {notice && <p role="status" className="mt-3 text-[13px] text-p-success">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-[13px] text-p-danger">{error}</p>}
    </Panel>
  );
};

export default ResourceAdminPanel;
