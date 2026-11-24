// services/provisioning/dbBackup.js
//
// Schedules an off-server backup for the database a customer has just bought.
//
// WHY THIS IS A VOLUME BACKUP AND NOT A DATABASE BACKUP
//   The coolify lane creates a customer's database (db-mysql / db-postgres /
//   db-mongo / db-redis) as a Coolify SERVICE from a compose file, not as one
//   of Coolify's standalone database resources. Coolify's database backup API
//   (POST /api/v1/databases/{uuid}/backups, which takes logical dumps) only
//   reaches standalone databases, so it cannot see these. What the API does
//   offer for a service is a scheduled backup of one of its persistent
//   volumes, saved to an S3 destination. The database's data folder is that
//   volume, so that is what is backed up.
//
// WHY THE DATABASE IS STOPPED DURING THE COPY (the default)
//   Copying the data folder of a running database is not reliable: the files
//   are read at slightly different moments, so the copy can be one the
//   database cannot open. Stopping the database for the length of the copy
//   gives a copy that restores cleanly. For the small databases sold here that
//   is seconds, and the schedule defaults to 02:00 Nairobi time. Set
//   COOLIFY_DB_BACKUP_STOP=false to copy while running instead, and accept
//   that a restore may need repair.
//
// BEHAVIOUR
//   - Idempotent. Coolify replaces the schedule of a volume rather than adding
//     another, so running this twice leaves one schedule.
//   - Never throws. The result is { status, detail }, where status is one of
//     the job doctype's backup_status values: configured | skipped | failed.
//     A database is still handed over when its backup could not be scheduled,
//     but the job shows "failed" and the retry sweep (dbBackupSweep.js) tries
//     again, so a gap is visible and is closed without anyone remembering to.
//   - Off by default. Nothing is scheduled until the S3 destination is named
//     (COOLIFY_DB_BACKUP_S3_UUID or COOLIFY_DB_BACKUP_S3_NAME); until then the
//     result is "skipped" and says why.

const DEFAULT_FREQUENCY = "0 23 * * *"; // 23:00 UTC = 02:00 in Nairobi

function trim(v) {
  return String(v ?? "").trim();
}

function boundedInt(raw, dflt, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** All tunables, read from the environment on each call so tests can change them. */
function settings(env = process.env) {
  return {
    s3Uuid: trim(env.COOLIFY_DB_BACKUP_S3_UUID),
    s3Name: trim(env.COOLIFY_DB_BACKUP_S3_NAME),
    frequency: trim(env.COOLIFY_DB_BACKUP_FREQUENCY) || DEFAULT_FREQUENCY,
    retentionS3: boundedInt(env.COOLIFY_DB_BACKUP_RETENTION, 14, 1, 10000),
    retentionLocal: boundedInt(env.COOLIFY_DB_BACKUP_LOCAL_RETENTION, 2, 0, 10000),
    stopDuringBackup: trim(env.COOLIFY_DB_BACKUP_STOP).toLowerCase() !== "false",
    // Coolify raises its own alert if a schedule produces nothing for this long.
    missingBackupDays: boundedInt(env.COOLIFY_DB_BACKUP_MISSING_DAYS, 2, 1, 365),
  };
}

/** True once an S3 destination has been named. Without it nothing is scheduled. */
function isConfigured(env = process.env) {
  const s = settings(env);
  return !!(s.s3Uuid || s.s3Name);
}

function notConfiguredDetail() {
  return "customer database backups are off: set COOLIFY_DB_BACKUP_S3_UUID (or COOLIFY_DB_BACKUP_S3_NAME) to the Coolify S3 destination";
}

function normPath(p) {
  const s = trim(p).replace(/\/+$/, "");
  return s === "" ? "/" : s;
}

function describeError(e) {
  const status = e?.response?.status;
  const msg = e?.response?.data?.message || e?.message || String(e);
  const errors = e?.response?.data?.errors;
  const extra = errors ? ` ${JSON.stringify(errors)}` : "";
  const hint =
    status === 403
      ? " (the Coolify token may lack the deploy permission needed to stop the database during the backup; allow it, or set COOLIFY_DB_BACKUP_STOP=false)"
      : "";
  return `${status ? `HTTP ${status}: ` : ""}${msg}${extra}${hint}`.slice(0, 400);
}

/** Find the configured S3 destination in Coolify and make sure it is usable. */
async function resolveS3Storage(client, s) {
  const res = await client.get("/api/v1/s3-storages");
  const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
  let matches;
  if (s.s3Uuid) {
    matches = list.filter((x) => x.uuid === s.s3Uuid);
  } else {
    const want = s.s3Name.toLowerCase();
    matches = list.filter((x) => trim(x.name).toLowerCase() === want);
  }
  if (matches.length === 0) {
    throw new Error(
      `S3 destination ${s.s3Uuid ? `with uuid ${s.s3Uuid}` : `named "${s.s3Name}"`} was not found in Coolify`
    );
  }
  if (matches.length > 1) {
    throw new Error(`more than one S3 destination is named "${s.s3Name}"; use COOLIFY_DB_BACKUP_S3_UUID instead`);
  }
  const hit = matches[0];
  if (hit.is_usable === false) {
    throw new Error(`S3 destination "${hit.name}" is not usable; open it in Coolify and validate the connection`);
  }
  return hit.uuid;
}

/** The persistent volume mounted at the database's data folder, or an error. Never guesses. */
async function findDataVolume(client, serviceUuid, volumePath) {
  const res = await client.get(`/api/v1/services/${encodeURIComponent(serviceUuid)}/storages`);
  const persistent = res.data?.persistent_storages || [];
  const want = normPath(volumePath);
  const hits = persistent.filter((v) => normPath(v.mount_path) === want);
  if (hits.length === 0) {
    throw new Error(`no persistent volume is mounted at ${want} on this service`);
  }
  if (hits.length > 1) {
    throw new Error(`${hits.length} persistent volumes are mounted at ${want}; refusing to guess which one to back up`);
  }
  if (!hits[0].uuid) {
    throw new Error("the data volume has no uuid in Coolify's response");
  }
  return hits[0].uuid;
}

/** A plain 5-field cron expression; Coolify also accepts words, so this only catches typos. */
function frequencyLooksValid(f) {
  return /^\S+(\s+\S+){4}$/.test(f) || /^(hourly|daily|weekly|monthly|yearly)$/i.test(f);
}

/**
 * Make sure this service's database volume has a backup schedule saved to S3.
 *
 * @param client       axios-like Coolify client (baseURL + token already set)
 * @param ctx.serviceUuid  the Coolify service uuid (the job's external_ref)
 * @param ctx.volumePath   the database's data folder inside the container
 * @returns {Promise<{status:'configured'|'skipped'|'failed', detail:string, scheduleUuid?:string}>}
 */
async function ensureDatabaseBackup(client, ctx, env = process.env) {
  const s = settings(env);
  if (!(s.s3Uuid || s.s3Name)) {
    return { status: "skipped", detail: notConfiguredDetail() };
  }
  try {
    if (!ctx?.serviceUuid) throw new Error("no Coolify service uuid for this job");
    if (!ctx?.volumePath) throw new Error("no data folder is known for this database engine");
    if (!frequencyLooksValid(s.frequency)) {
      throw new Error(`COOLIFY_DB_BACKUP_FREQUENCY "${s.frequency}" is not a cron expression`);
    }

    const s3Uuid = await resolveS3Storage(client, s);
    const volumeUuid = await findDataVolume(client, ctx.serviceUuid, ctx.volumePath);

    const res = await client.put(
      `/api/v1/services/${encodeURIComponent(ctx.serviceUuid)}/storages/${encodeURIComponent(volumeUuid)}/backups`,
      {
        frequency: s.frequency,
        enabled: true,
        save_s3: true,
        s3_storage_uuid: s3Uuid,
        stop_during_backup: s.stopDuringBackup,
        retention_amount_s3: s.retentionS3,
        retention_amount_locally: s.retentionLocal,
        missing_backup_notification_days: s.missingBackupDays,
      }
    );
    const body = res.data?.data || res.data || {};
    if (body.enabled === false || body.save_s3 === false) {
      // Coolify answered but did not keep what was asked: do not call that configured.
      throw new Error("Coolify saved the schedule but it is not enabled for S3");
    }
    return {
      status: "configured",
      scheduleUuid: body.uuid ? String(body.uuid) : undefined,
      detail:
        `volume backup ${s.frequency} UTC to S3, keeping ${s.retentionS3}` +
        `${s.stopDuringBackup ? ", database stopped during the copy" : ", copied while running"}`,
    };
  } catch (e) {
    return { status: "failed", detail: describeError(e) };
  }
}

/**
 * "m h * * *" (a once-a-day schedule in UTC) as a clock time in East Africa
 * Time, which is UTC+3 all year with no daylight saving. Anything that is not a
 * plain daily schedule returns null: the customer is then told "every night"
 * without a time, rather than a time we derived from an expression we did not
 * fully understand.
 */
function dailyTimeEat(frequency) {
  const m = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec(trim(frequency));
  if (!m) return null;
  const minute = Number(m[1]);
  const hour = Number(m[2]);
  if (minute > 59 || hour > 23) return null;
  const eat = (hour + 3) % 24;
  return `${String(eat).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * What the customer's portal may say about their database's backup.
 *
 * Built only from what we recorded (the job's backup_status) and the settings,
 * never from a live check, so it promises "set up", not "the last backup
 * worked": nothing here has looked at whether the last run succeeded.
 *   state "active"      the schedule is saved in Coolify
 *   state "setting_up"  anything else (pending, skipped, failed): not active yet
 * `when` is the nightly time in East Africa Time, or null. `brieflyStopped` is
 * true when the database is stopped for the few seconds the copy takes, which
 * the customer is told because connections made at that moment fail.
 */
function customerSummary(backupStatus, env = process.env) {
  const s = settings(env);
  const active = backupStatus === "configured";
  return {
    state: active ? "active" : "setting_up",
    when: active ? dailyTimeEat(s.frequency) : null,
    brieflyStopped: active && s.stopDuringBackup,
  };
}

module.exports = {
  DEFAULT_FREQUENCY,
  dailyTimeEat,
  customerSummary,
  settings,
  isConfigured,
  ensureDatabaseBackup,
  // exported for tests
  resolveS3Storage,
  findDataVolume,
  normPath,
};
