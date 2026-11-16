import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import {
  EnvVar,
  createEnvVar,
  deleteEnvVar,
  fetchEnvVars,
  restartService,
  updateEnvVar,
} from "../../../services/resourceAdmin";
import { envsToText, saveEnvText } from "../../../services/serviceSettings";
import { toUserMessage } from "../../../services/errors";
import { Banner, Empty, Field, PButton, Panel, inputClass } from "../ui";

interface Props {
  serviceId: string;
}

/**
 * Environment variables for one service, in two views of the same data: a table
 * for one-off edits and a "Developer view" text editor for pasting a whole
 * `.env` file. Changes are saved immediately but only reach the running
 * container after a restart, and the panel says so rather than implying
 * they are live.
 */
const EnvironmentPanel: React.FC<Props> = ({ serviceId }) => {
  const [envs, setEnvs] = useState<EnvVar[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");

  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [draftBuild, setDraftBuild] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [devView, setDevView] = useState(false);
  const [text, setText] = useState("");
  const [savingText, setSavingText] = useState(false);

  const load = useCallback(() => {
    setError("");
    return fetchEnvVars(serviceId)
      .then(setEnvs)
      .catch((e: any) => { setEnvs([]); setError(toUserMessage(e, "Couldn't load variables.")); });
  }, [serviceId]);

  useEffect(() => { setEnvs(null); load(); }, [load]);

  const hiddenCount = useMemo(() => (envs || []).filter((e) => e.redacted).length, [envs]);
  const shown = useMemo(
    () => (envs || []).filter((e) => !query.trim() || e.key.toLowerCase().includes(query.trim().toLowerCase())),
    [envs, query]
  );

  const afterWrite = async (message: string) => {
    setNotice(message);
    setRestartNeeded(true);
    await load();
  };

  const handleSave = async () => {
    const key = draftKey.trim();
    if (!key) return;
    setSaving(true);
    setError("");
    try {
      const exists = envs?.some((e) => e.key === key);
      const res = exists
        ? await updateEnvVar(serviceId, key, { value: draftValue, isBuildTime: draftBuild })
        : await createEnvVar(serviceId, { key, value: draftValue, isBuildTime: draftBuild });
      setDraftKey(""); setDraftValue(""); setDraftBuild(false);
      await afterWrite(res.message);
    } catch (e: any) {
      setError(toUserMessage(e, "Couldn't save that variable."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (env: EnvVar) => {
    if (deleting) return;
    setDeleting(env.uuid);
    setError("");
    try {
      await afterWrite((await deleteEnvVar(serviceId, env.uuid)).message);
    } catch (e: any) {
      setError(toUserMessage(e, "Couldn't remove that variable."));
    } finally {
      setDeleting(null);
    }
  };

  const edit = (env: EnvVar) => {
    setDraftKey(env.key);
    setDraftValue(env.value ?? "");
    setDraftBuild(env.isBuildTime);
    setDevView(false);
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      setNotice((await restartService(serviceId)).message);
      setRestartNeeded(false);
    } catch (e: any) {
      setError(toUserMessage(e, "Couldn't restart the service."));
    } finally {
      setRestarting(false);
    }
  };

  const openDevView = () => {
    setText(envsToText(envs || []));
    setDevView(true);
  };

  const handleSaveText = async () => {
    setSavingText(true);
    setError("");
    try {
      const res = await saveEnvText(serviceId, text);
      await afterWrite(res.message);
    } catch (e: any) {
      setError(toUserMessage(e, "Couldn't save those variables."));
    } finally {
      setSavingText(false);
    }
  };

  return (
    <div className="space-y-4">
      {restartNeeded && (
        <Banner tone="warning" action={restarting ? undefined : { label: "Restart now", onClick: handleRestart }}>
          Saved, but not live yet. Your service keeps its current environment until it restarts.
        </Banner>
      )}
      {notice && !restartNeeded && <p role="status" className="text-[13px] text-p-success">{notice}</p>}
      {error && <p role="alert" className="text-[13px] text-p-danger">{error}</p>}

      <Panel
        title="Environment variables"
        description="Settings your app reads when it starts, like API keys and URLs."
        flush={!devView}
        actions={
          devView ? (
            <PButton size="sm" onClick={() => setDevView(false)}>Table view</PButton>
          ) : (
            <PButton size="sm" onClick={openDevView} disabled={envs === null}>Developer view</PButton>
          )
        }
      >
        {devView ? (
          <div className="space-y-3">
            <p className="text-[13px] text-p-muted">
              One <code className="font-mono">NAME=value</code> per line. Saving adds new variables and updates
              existing ones; it never deletes. Remove a variable from the table view.
              {hiddenCount > 0 && ` ${hiddenCount} write-only secret${hiddenCount === 1 ? " is" : "s are"} not shown here and stay as they are.`}
            </p>
            <textarea
              aria-label="Environment variables as text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={14}
              spellCheck={false}
              className={`${inputClass} font-mono text-[13px] leading-relaxed py-2`}
            />
            <PButton variant="primary" loading={savingText} onClick={handleSaveText} disabled={!text.trim()}>
              {savingText ? "Saving…" : "Save all"}
            </PButton>
          </div>
        ) : envs === null ? (
          <p className="px-4 sm:px-5 py-4 text-[13px] text-p-muted">Loading…</p>
        ) : (
          <>
            <div className="px-4 sm:px-5 py-3 border-b border-p-border">
              <input
                type="search"
                aria-label="Search variables"
                placeholder="Search variables"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={inputClass}
              />
            </div>
            {envs.length === 0 ? (
              <Empty title="No variables yet" description="Add the first one below." />
            ) : shown.length === 0 ? (
              <p className="px-4 sm:px-5 py-4 text-[13px] text-p-muted">No variable matches that search.</p>
            ) : (
              <ul className="divide-y divide-p-border">
                {shown.map((env) => (
                  <li key={env.uuid || env.key} className="flex items-center gap-3 px-4 sm:px-5 py-2.5">
                    <code className="text-[13px] font-medium text-p-text shrink-0 max-w-[40%] truncate">{env.key}</code>
                    <code className="text-[13px] text-p-muted truncate grow">
                      {env.redacted
                        ? "write-only"
                        : revealed[env.key]
                          ? env.value ?? ""
                          : "•".repeat(Math.min(12, (env.value || "").length) || 4)}
                    </code>
                    {env.isBuildTime && (
                      <span className="hidden sm:inline text-[11px] text-p-muted border border-p-border rounded px-1.5 py-0.5">build</span>
                    )}
                    {!env.redacted && (
                      <button
                        type="button"
                        onClick={() => setRevealed((r) => ({ ...r, [env.key]: !r[env.key] }))}
                        aria-label={revealed[env.key] ? `Hide ${env.key}` : `Show ${env.key}`}
                        className="text-p-muted hover:text-p-text p-1"
                      >
                        {revealed[env.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    )}
                    <button type="button" onClick={() => edit(env)} aria-label={`Edit ${env.key}`} className="text-p-muted hover:text-p-text p-1">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(env)}
                      disabled={!!deleting}
                      aria-label={`Remove ${env.key}`}
                      className="text-p-muted hover:text-p-danger p-1 disabled:opacity-40"
                    >
                      <Trash2 className={`w-4 h-4 ${deleting === env.uuid ? "animate-pulse" : ""}`} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>

      {!devView && (
        <Panel title={envs?.some((e) => e.key === draftKey.trim()) ? "Update a variable" : "Add a variable"}>
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end"
            onSubmit={(e) => { e.preventDefault(); handleSave(); }}
          >
            <Field label="Name" htmlFor="env-key">
              <input id="env-key" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder="API_URL" className={`${inputClass} font-mono`} />
            </Field>
            <Field label="Value" htmlFor="env-value">
              <input id="env-value" value={draftValue} onChange={(e) => setDraftValue(e.target.value)} placeholder="https://…" className={`${inputClass} font-mono`} />
            </Field>
            <PButton type="submit" variant="primary" icon={<Plus className="w-4 h-4" />} loading={saving} disabled={!draftKey.trim()}>
              {saving ? "Saving…" : "Save"}
            </PButton>
          </form>
          <label className="mt-3 inline-flex items-center gap-2 text-[13px] text-p-muted cursor-pointer">
            <input type="checkbox" checked={draftBuild} onChange={(e) => setDraftBuild(e.target.checked)} />
            Also available while building
            {draftBuild && <Check className="w-3.5 h-3.5 text-p-success" />}
          </label>
          <p className="mt-2 text-[13px] text-p-muted">
            Letters, numbers and underscores only. Saving an existing name replaces its value.
          </p>
        </Panel>
      )}
    </div>
  );
};

export default EnvironmentPanel;
