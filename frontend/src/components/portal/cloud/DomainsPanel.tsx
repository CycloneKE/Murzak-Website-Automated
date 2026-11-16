import React, { useCallback, useEffect, useState } from "react";
import { ExternalLink, Globe, Trash2 } from "lucide-react";
import { ServiceDomain, addDomain, fetchDomains, removeDomain } from "../../../services/serviceSettings";
import { toUserMessage } from "../../../services/errors";
import { Empty, Field, Modal, PButton, Panel, StatusPill, inputClass } from "../ui";

/**
 * Every address a service answers on: the built-in one plus any domains the
 * customer has connected. Adding checks DNS first (server side); removing asks
 * for confirmation because the site stops answering on that name immediately.
 */
const DomainsPanel: React.FC<{ serviceId: string }> = ({ serviceId }) => {
  const [domains, setDomains] = useState<ServiceDomain[] | null>(null);
  const [serverIp, setServerIp] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<ServiceDomain | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await fetchDomains(serviceId);
      setDomains(r.domains);
      setServerIp(r.serverIp);
    } catch (e: any) {
      setDomains([]);
      setError(toUserMessage(e, "Couldn't load domains."));
    }
  }, [serviceId]);

  useEffect(() => { setDomains(null); setResult(null); load(); }, [load]);

  const add = async () => {
    const domain = input.trim().toLowerCase();
    if (!domain) return;
    setAdding(true);
    setResult(null);
    try {
      const r = await addDomain(serviceId, domain);
      setResult({ ok: true, text: r.message });
      setInput("");
      await load();
    } catch (e: any) {
      setResult({ ok: false, text: toUserMessage(e, "Couldn't connect that domain.") });
    } finally {
      setAdding(false);
    }
  };

  const remove = async () => {
    if (!confirm) return;
    setRemoving(true);
    try {
      const r = await removeDomain(serviceId, confirm.host);
      setResult({ ok: true, text: r.message });
      setConfirm(null);
      await load();
    } catch (e: any) {
      setResult({ ok: false, text: toUserMessage(e, "Couldn't remove that domain.") });
      setConfirm(null);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Panel title="Domains" description="The addresses your service answers on. SSL is issued automatically." flush>
        {error && <p role="alert" className="px-4 sm:px-5 py-3 text-[13px] text-p-danger">{error}</p>}
        {domains === null ? (
          <p className="px-4 sm:px-5 py-4 text-[13px] text-p-muted">Loading…</p>
        ) : domains.length === 0 && !error ? (
          <Empty icon={<Globe />} title="No addresses yet" description="Connect a domain below." />
        ) : (
          <ul className="divide-y divide-p-border">
            {domains.map((d) => (
              <li key={d.host} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                <Globe className="w-4 h-4 text-p-muted shrink-0" />
                <a
                  href={`${d.scheme}://${d.host}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-p-text hover:text-p-accent-text truncate inline-flex items-center gap-1"
                >
                  {d.host}
                  <ExternalLink className="w-3 h-3 shrink-0" aria-hidden />
                </a>
                {d.system && <StatusPill tone="idle">Built in</StatusPill>}
                <div className="grow" />
                {!d.system && (
                  <button
                    type="button"
                    onClick={() => setConfirm(d)}
                    aria-label={`Remove ${d.host}`}
                    className="text-p-muted hover:text-p-danger p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Connect your own domain"
        description={
          serverIp
            ? `Add an A record pointing the domain at ${serverIp}, then connect it here. DNS can take a few minutes to update.`
            : "Point an A record at our server, then connect it here."
        }
      >
        <form className="flex flex-col sm:flex-row sm:items-end gap-3" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <div className="grow">
            <Field label="Domain" htmlFor="dom-input">
              <input id="dom-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="shop.yourbusiness.co.ke" className={inputClass} />
            </Field>
          </div>
          <PButton type="submit" variant="primary" loading={adding} disabled={!input.trim()}>
            {adding ? "Connecting…" : "Connect"}
          </PButton>
        </form>
        {result && (
          <p role="status" className={`mt-3 text-[13px] ${result.ok ? "text-p-success" : "text-p-danger"}`}>{result.text}</p>
        )}
      </Panel>

      <Modal open={!!confirm} onClose={() => !removing && setConfirm(null)} title={`Remove ${confirm?.host || ""}?`}>
        <p className="text-sm text-p-muted">
          Your service will stop answering on this name straight away. Visitors using it will see an error until you
          connect it again.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <PButton onClick={() => setConfirm(null)} disabled={removing}>Keep it</PButton>
          <PButton variant="danger" loading={removing} onClick={remove}>Remove domain</PButton>
        </div>
      </Modal>
    </div>
  );
};

export default DomainsPanel;
