
const express = require('express');
// Not destructured at import time — test/routesContext.test.js's static guard
// greedily matches the first destructuring-brace pattern through to the ctx
// destructure below (see portalRoutes.js for the same convention).
const SESSION_DOCTYPE = require('../services/terminal/constants').SESSION_DOCTYPE;
const retentionLib = require('../services/terminal/retention');

// Broker -> backend session reporting (P5.4). The broker holds no Frappe
// creds by design (broker/index.js header) so it reports session lifecycle
// facts here instead, over the SAME shared secret already used for
// backend->broker calls (BROKER_API_KEY) — just in the other direction. This
// is an internal-only surface: no user session, no requireAuth, gated
// entirely on the shared key (mirrors broker's own backendAuthed() check).
module.exports = function (ctx) {
  const { frappeClient, PROVISIONING_JOB_DOCTYPE } = ctx;

  const router = express.Router();

  function brokerAuthed(req, res) {
    const key = process.env.BROKER_API_KEY;
    if (!key || req.headers['x-broker-key'] !== key) {
      res.status(401).json({ error: 'Unauthorized.' });
      return false;
    }
    return true;
  }

  router.post('/api/internal/terminal/sessions/start', async (req, res) => {
    if (!brokerAuthed(req, res)) return;
    const { sessionId, webAccount, jobName, containerName, startedAt } = req.body || {};
    if (!sessionId || !webAccount || !jobName) {
      return res.status(400).json({ error: 'sessionId, webAccount, jobName are required.' });
    }

    const client = frappeClient();
    try {
      // Re-verify the job actually belongs to the reported account — the
      // broker only forwards what the mint route put in the token, but this
      // endpoint doesn't get to just trust that blindly either.
      const jobResp = await client.get(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}/${encodeURIComponent(jobName)}`);
      const job = jobResp.data?.data;
      if (!job || job.web_account !== webAccount) {
        console.error('TERMINAL SESSION START: job/account mismatch', jobName, webAccount);
        return res.status(409).json({ error: 'Job/account mismatch.' });
      }

      await client.post('/api/method/frappe.client.insert', {
        doc: {
          doctype: SESSION_DOCTYPE,
          session_id: sessionId,
          web_account: webAccount,
          provisioning_job: jobName,
          service_id: job.service_id,
          container_name: containerName || '',
          started_at: startedAt || new Date().toISOString(),
        },
      });
      return res.json({ ok: true });
    } catch (err) {
      console.error('TERMINAL SESSION START ERROR:', err.response?.data || err.message);
      return res.status(500).json({ error: 'Failed to record session start.' });
    }
  });

  router.post('/api/internal/terminal/sessions/end', async (req, res) => {
    if (!brokerAuthed(req, res)) return;
    const { sessionId, exitReason, endedAt, durationSeconds, byteCount, recordingKey } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required.' });

    const client = frappeClient();
    try {
      const resp = await client.get(`/api/resource/${encodeURIComponent(SESSION_DOCTYPE)}`, {
        params: {
          filters: JSON.stringify([['session_id', '=', sessionId]]),
          fields: JSON.stringify(['name', 'started_at']),
          limit_page_length: 1,
        },
      });
      const row = resp.data?.data?.[0];
      if (!row) {
        // The start report may have failed independently (best-effort by
        // design) — an end report with nothing to update is a known,
        // non-fatal gap, not a crash.
        console.warn('TERMINAL SESSION END: no matching session row for', sessionId);
        return res.json({ ok: true, note: 'No matching session row.' });
      }

      const startedAtMs = Date.parse(row.started_at);
      const { tier, flaggedReason } = retentionLib.computeRetentionTier({ exitReason });
      const expiresAtMs = retentionLib.computeExpiresAtMs(tier, Number.isFinite(startedAtMs) ? startedAtMs : Date.now());

      await client.put(`/api/resource/${encodeURIComponent(SESSION_DOCTYPE)}/${encodeURIComponent(row.name)}`, {
        ended_at: endedAt || new Date().toISOString(),
        duration_seconds: durationSeconds || 0,
        exit_reason: exitReason || '',
        byte_count: byteCount || 0,
        recording_key: recordingKey || '',
        retention_tier: tier,
        expires_at: expiresAtMs ? new Date(expiresAtMs).toISOString() : '',
        flagged_reason: flaggedReason || '',
      });
      return res.json({ ok: true });
    } catch (err) {
      console.error('TERMINAL SESSION END ERROR:', err.response?.data || err.message);
      return res.status(500).json({ error: 'Failed to record session end.' });
    }
  });

  return router;
};
