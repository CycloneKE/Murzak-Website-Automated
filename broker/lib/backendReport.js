/**
 * Broker -> backend session reporting. The broker holds no Frappe creds by
 * design (see index.js header) so it can't write the Terminal Session
 * doctype itself; it reports session lifecycle facts to a backend-internal
 * endpoint instead, authenticated with the SAME shared secret used for
 * backend->broker calls (BROKER_API_KEY), just in the other direction.
 *
 * Both calls are best-effort: a reporting failure must never affect the live
 * session or crash the broker, so every call here is caught and logged, never
 * thrown to the caller.
 */

const axios = require("axios");

const BACKEND_INTERNAL_URL = (process.env.BACKEND_INTERNAL_URL || "").replace(/\/+$/, "");
const API_KEY = process.env.BROKER_API_KEY || "";

async function post(path, body) {
  if (!BACKEND_INTERNAL_URL || !API_KEY) return; // not configured — degrade silently, don't block the session
  try {
    await axios.post(`${BACKEND_INTERNAL_URL}${path}`, body, {
      headers: { "x-broker-key": API_KEY },
      timeout: 5000,
    });
  } catch (e) {
    console.error(`[broker] backend report failed (${path}):`, e.response?.data || e.message);
  }
}

function reportSessionStart({ sessionId, webAccount, jobName, containerName, startedAt }) {
  return post("/api/internal/terminal/sessions/start", { sessionId, webAccount, jobName, containerName, startedAt });
}

function reportSessionEnd({ sessionId, exitReason, endedAt, durationSeconds, byteCount, recordingKey }) {
  return post("/api/internal/terminal/sessions/end", { sessionId, exitReason, endedAt, durationSeconds, byteCount, recordingKey });
}

module.exports = { reportSessionStart, reportSessionEnd };
