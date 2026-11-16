import React, { useEffect, useState } from "react";
import { BackupSchedule, fetchBackups } from "../../../services/serviceSettings";
import { createPortalThread } from "../../../services/portalChat";
import { toUserMessage } from "../../../services/errors";
import { Banner, PButton, Panel, StatusPill } from "../ui";

interface Props {
  serviceId: string;
  serviceName: string;
}

/**
 * Backup schedules. Only databases expose a schedule we can read; for
 * everything else the panel says so plainly and offers a request to our team,
 * rather than an empty list a customer could read as "not backed up".
 */
const BackupsPanel: React.FC<Props> = ({ serviceId, serviceName }) => {
  const [state, setState] = useState<{ supported: boolean; schedules: BackupSchedule[] } | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setState(null);
    setError("");
    fetchBackups(serviceId).then(setState).catch((e: any) => setError(toUserMessage(e, "Couldn't load backup status.")));
  }, [serviceId]);

  const requestBackup = async () => {
    setSending(true);
    try {
      await createPortalThread({
        subject: `Backup schedule request: ${serviceName}`,
        message: `Service: ${serviceName} (${serviceId})\nRequest type: Backup schedule\n\nPlease set up a backup schedule for this service.`,
      });
      setSent(true);
    } catch (e: any) {
      setError(toUserMessage(e, "Couldn't send that request."));
    } finally {
      setSending(false);
    }
  };

  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!state) return <Panel><p className="text-[13px] text-p-muted">Loading…</p></Panel>;

  if (!state.supported) {
    return (
      <Panel
        title="Backups"
        description="Backup schedules for this kind of service are set up by our team."
        actions={
          sent ? (
            <StatusPill tone="ok">Request sent</StatusPill>
          ) : (
            <PButton variant="primary" loading={sending} onClick={requestBackup}>Request a backup schedule</PButton>
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
