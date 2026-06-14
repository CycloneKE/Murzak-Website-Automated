// utils/loginThrottle.js
// Per-account brute-force lockout for credential endpoints.
//
// The express-rate-limit middleware throttles by IP, but a distributed attacker
// (botnet / rotating proxies) can spread guesses across many IPs against ONE
// account and slip under an IP limit. This adds an account-keyed counter:
// after MAX_FAILURES failed attempts inside WINDOW_SECONDS, the account is locked
// for the remainder of the window. A successful login clears the counter.
//
// Backed by Redis when available (atomic INCR + EXPIRE, multi-instance safe);
// falls back to an in-memory Map for single-instance / no-Redis dev. Keys are
// hashed so raw emails are never written to the store.

const crypto = require("crypto");

const MAX_FAILURES = 8; // attempts allowed inside the window before lockout
const WINDOW_SECONDS = 15 * 60; // counter lifetime / lockout duration
const PREFIX = "murzak:loginfail:";

function keyFor(identifier) {
  const norm = String(identifier || "").trim().toLowerCase();
  const h = crypto.createHash("sha256").update(norm).digest("hex");
  return PREFIX + h;
}

/**
 * Create a throttle bound to an optional redis client. Pass the same client
 * used for the session store, or null/undefined to use the in-memory fallback.
 */
function createLoginThrottle(redisClient) {
  // In-memory fallback state: Map<key, { count, expiresAt(ms) }>
  const mem = new Map();

  function memGet(key) {
    const rec = mem.get(key);
    if (!rec) return null;
    if (rec.expiresAt <= Date.now()) {
      mem.delete(key);
      return null;
    }
    return rec;
  }

  // Opportunistic prune so the Map can't grow unbounded under attack.
  function memPrune() {
    const now = Date.now();
    for (const [k, v] of mem) {
      if (v.expiresAt <= now) mem.delete(k);
    }
  }

  const useRedis = () => redisClient && redisClient.isReady;

  return {
    MAX_FAILURES,
    WINDOW_SECONDS,

    /**
     * @returns {Promise<{locked: boolean, retryAfterSeconds: number}>}
     */
    async check(identifier) {
      const key = keyFor(identifier);
      try {
        if (useRedis()) {
          const count = Number(await redisClient.get(key)) || 0;
          if (count >= MAX_FAILURES) {
            const ttl = await redisClient.ttl(key);
            return { locked: true, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS };
          }
          return { locked: false, retryAfterSeconds: 0 };
        }
      } catch (e) {
        console.warn("LOGIN THROTTLE check (redis) failed, allowing:", e.message);
        return { locked: false, retryAfterSeconds: 0 };
      }

      const rec = memGet(key);
      if (rec && rec.count >= MAX_FAILURES) {
        return {
          locked: true,
          retryAfterSeconds: Math.max(1, Math.ceil((rec.expiresAt - Date.now()) / 1000)),
        };
      }
      return { locked: false, retryAfterSeconds: 0 };
    },

    /**
     * Record one failed attempt. Returns the updated state so the caller can
     * surface a lockout that the failing attempt itself triggered.
     */
    async recordFailure(identifier) {
      const key = keyFor(identifier);
      try {
        if (useRedis()) {
          const count = await redisClient.incr(key);
          if (count === 1) {
            await redisClient.expire(key, WINDOW_SECONDS);
          }
          const locked = count >= MAX_FAILURES;
          let retryAfterSeconds = 0;
          if (locked) {
            const ttl = await redisClient.ttl(key);
            retryAfterSeconds = ttl > 0 ? ttl : WINDOW_SECONDS;
          }
          return { locked, retryAfterSeconds };
        }
      } catch (e) {
        console.warn("LOGIN THROTTLE recordFailure (redis) failed:", e.message);
        return { locked: false, retryAfterSeconds: 0 };
      }

      memPrune();
      const existing = memGet(key);
      if (existing) {
        existing.count += 1;
      } else {
        mem.set(key, { count: 1, expiresAt: Date.now() + WINDOW_SECONDS * 1000 });
      }
      const rec = mem.get(key);
      const locked = rec.count >= MAX_FAILURES;
      return {
        locked,
        retryAfterSeconds: locked
          ? Math.max(1, Math.ceil((rec.expiresAt - Date.now()) / 1000))
          : 0,
      };
    },

    /** Clear the counter (call on successful authentication). */
    async reset(identifier) {
      const key = keyFor(identifier);
      try {
        if (useRedis()) {
          await redisClient.del(key);
          return;
        }
      } catch (e) {
        console.warn("LOGIN THROTTLE reset (redis) failed:", e.message);
      }
      mem.delete(key);
    },
  };
}

module.exports = { createLoginThrottle };
