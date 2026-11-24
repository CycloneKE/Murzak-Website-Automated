import React, { useEffect, useState } from "react";
import { BackupsResponse, fetchBackups } from "../../../services/serviceSettings";
import { createPortalThread } from "../../../services/portalChat";
import { toUserMessage } from "../../../services/errors";
import { Banner, PButton, Panel, StatusPill } from "../ui";

interface Props {
  serviceId: string;
  serviceName: string;
}

/**
 * Backup schedules. Three cases, each stated plainly:
 *  - a customer's database, whose backup we schedule ourselves ("managed"): says whether it is set up, when,
 *    and that the database is stopped for a few seconds during the copy. It says "set up", never "the last
 *    backup worked", because nothing here checks that;
 *  - a standalone database Coolify can report on: its schedules;
 *  - everything else: we can't show a schedule, and the customer can ask our team,
 *    rather than seeing an empty list they could read as "not backed up".
 */
const BackupsPanel: React.FC<Props> = ({ serviceId, serviceName }) => {
  const [state, setState] = useState<BackupsResponse | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setState(null);
    setError("");
    fetchBackups(serviceId).then(setState).catch((e: any) => setError(toUserMessage(e, "Couldn't load backup status.")));
  }, [serviceId]);

  const requestBackup = async (kind: "schedule" | "restore" = "schedule") => {
    setSending(true);
    try {
      await createPortalThread(
        kind === "restore"
          ? {
              subject: `Restore request: ${serviceName}`,
              message: `Service: ${serviceName} (${serviceId})\nRequest type: Restore from backup\n\nI need a restore of this service from a backup. Please get in touch.`,
            }
          : {
              subject: `Backup schedule request: ${serviceName}`,
              message: `Service: ${serviceName} (${serviceId})\nRequest type: Backup schedule\n\nPlease set up a backup schedule for this service.`,
            }
      );
      setSent(true);
    } catch (e: any) {
      setError(toUserMessage(e, "Couldn't send that request."));
    } finally {
      setSending(false);
    }
  };

  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!state) return <Panel><p className="text-[13px] text-p-muted">Loading…</p></Panel>;

  if (state.managed) {
    const active = state.state === "active";
    return (
      <Panel
        title="Backups"
        description="Automatic backups for this database."
        actions={
          sent ? (
            <StatusPill tone="ok">Request sent</StatusPill>
          ) : (
            <PButton variant="secondary" loading={sending} onClick={() => requestBackup(active ? "restore" : "schedule")}>
              {active ? "Ask for a restore" : "Ask about backups"}
            </PButton>
          )
        }
      >
        <div className="flex items-center gap-3 mb-2">
          <StatusPill tone={active ? "ok" : "idle"}>{active ? "Backup set up" : "Not active yet"}</StatusPill>
        </div>
        {active ? (
          <>
            <p className="text-[13px] text-p-muted">
              This database is backed up automatically every night
              {state.when ? ` at about ${state.when} East Africa Time` : ""}, to storage separate from the server it runs on.
            </p>
            {state.brieflyStopped && (
              <p className="text-[13px] text-p-muted mt-2">
                The database is stopped for a few seconds while the copy is taken. An application connected at that
                moment loses its connection, so it should be set to reconnect.
              </p>
            )}
            <p className="text-[13px] text-p-muted mt-2">
              We can't show your backup history here yet. If you need to restore from a backup, send us a request and
              we'll follow up in your Support tab.
            </p>
          </>
        ) : (
          <p className="text-[13px] text-p-muted">
            Automatic backup isn't active for this database yet. If you need one sooner, or a copy of your data, send us
            a request and we'll follow up in your Support tab.
          </p>
        )}
      </Panel>
    );
  }

  if (!state.supported) {
    return (
      <Panel
        title="Backups"
        description="Backup schedules for this kind of service are set up by our team."
        actions={
          sent ? (
            <StatusPill tone="ok">Request sent</StatusPill>
          ) : (
            <PButton variant="primary" loading={sending} onClick={() => requestBackup("schedule")}>Request a backup schedule</PButton>
          )
        }
      >
        <p className="text-[13px] text-p-muted">
          We can't show your backup history here yet. If you need a schedule, or a restore from a past backup, send us a
          request and we'll follow up in your Support tab.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Backups" description="Scheduled backups for this database." flush>
      {state.schedules.length === 0 ? (
        <p className="px-4 sm:px-5 py-4 text-[13px] text-p-muted">No backup schedule is set up yet. Request one from our team in Support.</p>
      ) : (
        <ul className="divide-y divide-p-border">
          {state.schedules.map((s) => (
            <li key={s.uuid} className="flex flex-wrap items-center gap-3 px-4 sm:px-5 py-3">
              <StatusPill tone={s.enabled ? "ok" : "idle"}>{s.enabled ? "On" : "Paused"}</StatusPill>
              <code className="text-[13px] text-p-text">{s.frequency || "custom"}</code>
              <span className="text-[13px] text-p-muted grow">
                {s.lastRunAt ? `Last run ${s.lastRunAt}${s.lastStatus ? `, ${s.lastStatus}` : ""}` : "Has not run yet"}
              </span>
              {s.retentionCount !== null && <span className="text-[13px] text-p-muted">Keeps {s.retentionCount}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};

export default BackupsPanel;
