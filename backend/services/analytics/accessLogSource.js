"use strict";
/**
 * Reads the tail of the proxy's JSON access log.
 *
 * The log is a file on the proxy host that must be mounted read-only into the
 * backend container; its path comes from TRAEFIK_ACCESS_LOG_PATH. Unset means
 * "analytics not set up here", which the route reports as such, never as zero
 * traffic. Only the last TRAEFIK_ACCESS_LOG_MAX_BYTES are read (default 16 MB)
 * so a huge log can't stall the backend.
 */
const fs = require("fs");

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

function logPath() {
  return (process.env.TRAEFIK_ACCESS_LOG_PATH || "").trim();
}

function isConfigured() {
  return !!logPath();
}

function maxBytes() {
  const n = Number(process.env.TRAEFIK_ACCESS_LOG_MAX_BYTES);
  return Number.isFinite(n) && n >= 64 * 1024 ? Math.floor(n) : DEFAULT_MAX_BYTES;
}

/** Last lines of the log. Drops the first line when we started mid-file (it is cut off). */
async function readTailLines(file = logPath(), limit = maxBytes()) {
  const fh = await fs.promises.open(file, "r");
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - limit);
    const len = size - start;
    const buf = Buffer.alloc(len);
    if (len > 0) await fh.read(buf, 0, len, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    return lines;
  } finally {
    await fh.close();
  }
}

module.exports = { isConfigured, readTailLines, logPath, maxBytes };
