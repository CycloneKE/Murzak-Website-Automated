import React, { useEffect, useState } from "react";
import { Healthcheck, fetchHealthcheck, saveHealthcheck } from "../../../services/serviceSettings";
import { restartService } from "../../../services/resourceAdmin";
import { toUserMessage } from "../../../services/errors";
import { Banner, Field, PButton, Panel, inputClass } from "../ui";

const NUMBERS: { key: keyof Healthcheck; label: string; hint: string; min: number; max: number }[] = [
  { key: "intervalSeconds", label: "Check every (seconds)", hint: "How often we ask your app if it is healthy.", min: 1, max: 3600 },
  { key: "timeoutSeconds", label: "Wait up to (seconds)", hint: "How long to wait for each answer.", min: 1, max: 3600 },
  { key: "retries", label: "Failures before unhealthy", hint: "Consecutive failed checks.", min: 1, max: 100 },
  { key: "startPeriodSeconds", label: "Grace period (seconds)", hint: "Time to start up before failures count.", min: 0, max: 3600 },
];

/**
 * How we decide your app is up. A healthy check keeps traffic flowing during
 * an update; an unhealthy one stops a bad release from replacing a good one.
 */
const HealthcheckPanel: React.FC<{ serviceId: string }> = ({ serviceId }) => {
  const [hc, setHc] = useState<Healthcheck | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    setHc(null);
    fetchHealthcheck(serviceId).then(setHc).catch((e: any) => setError(toUserMessage(e, "Couldn't load healthcheck settings.")));
  }, [serviceId]);

  if (!hc) {
    return error ? <p role="alert" className="text-[13px] text-p-danger">{error}</p> : <Panel><p className="text-[13px] text-p-muted">Loading…</p></Panel>;
  }

  const set = <K extends keyof Healthcheck>(k: K, v: Healthcheck[K]) => setHc({ ...hc, [k]: v });

  const save = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { port, ...rest } = hc;
      const res = await saveHealthcheck(serviceId, port ? { ...rest, port } : rest);
      setNotice(res.message);
      setRestartNeeded(true);
    } catch (e: any) {
      setError(toUserMessage(e, "Couldn't save the healthcheck."));
    } finally {
      setSaving(false);
    }
  };

  const restart = async () => {
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

  return (
    <div className="space-y-4">
      {restartNeeded && (
        <Banner tone="warning" action={restarting ? undefined : { label: "Restart now", onClick: restart }}>
          Saved, but it applies on the next restart.
        </Banner>
      )}
      {error && <p role="alert" className="text-[13px] text-p-danger">{error}</p>}
      {notice && !restartNeeded && <p role="status" className="text-[13px] text-p-success">{notice}</p>}

      <Panel
        title="Healthcheck"
        description="A request we send to your app to confirm it is running."
        actions={<PButton variant="primary" loading={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</PButton>}
      >
        <label className="inline-flex items-center gap-2 text-sm text-p-text cursor-pointer mb-4">
          <input type="checkbox" checked={hc.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          Enable healthcheck
        </label>

        <div className={`grid gap-4 sm:grid-cols-2 ${hc.enabled ? "" : "opacity-60"}`}>
          <Field label="Path" htmlFor="hc-path" hint="The page we request, like /health.">
            <input id="hc-path" value={hc.path} disabled={!hc.enabled} onChange={(e) => set("path", e.target.value)} className={`${inputClass} font-mono`} />
          </Field>
          <Field label="Method" htmlFor="hc-method">
            <select id="hc-method" value={hc.method} disabled={!hc.enabled} onChange={(e) => set("method", e.target.value)} className={inputClass}>
              {["GET", "HEAD", "POST", "OPTIONS"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Scheme" htmlFor="hc-scheme">
            <select id="hc-scheme" value={hc.scheme} disabled={!hc.enabled} onChange={(e) => set("scheme", e.target.value)} className={inputClass}>
              <option>http</option>
              <option>https</option>
            </select>
          </Field>
          <Field label="Port" htmlFor="hc-port" hint="Leave empty to use your app's port.">
            <input
              id="hc-port"
              type="number"
              min={1}
              max={65535}
              value={hc.port ?? ""}
              disabled={!hc.enabled}
              onChange={(e) => set("port", e.target.value === "" ? null : Number(e.target.value))}
              className={inputClass}
            />
          </Field>
          <Field label="Expected status code" htmlFor="hc-code">
            <input
              id="hc-code"
              type="number"
              min={100}
              max={599}
              value={hc.returnCode}
              disabled={!hc.enabled}
              onChange={(e) => set("returnCode", Number(e.target.value))}
              className={inputClass}
            />
          </Field>
          {NUMBERS.map((n) => (
            <Field key={n.key} label={n.label} htmlFor={`hc-${n.key}`} hint={n.hint}>
              <input
                id={`hc-${n.key}`}
                type="number"
                min={n.min}
                max={n.max}
                value={hc[n.key] as number}
                disabled={!hc.enabled}
                onChange={(e) => set(n.key, Number(e.target.value) as never)}
                className={inputClass}
              />
            </Field>
          ))}
        </div>
      </Panel>
    </div>
  );
};

export default HealthcheckPanel;
