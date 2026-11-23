# Plan: per-visitor rate limits

Status: **plan only, nothing changed yet.** Written 2026-11-23.

## The problem in one paragraph

Every rate limit in the backend counts requests per visitor address, but the
backend never sees the visitor's address. Every request arrives from the
server's own internal Docker address, `10.0.1.1`, so every visitor on the
internet shares one allowance. Examples: all logins together get 20 attempts per
15 minutes, the whole API gets 120 requests per minute, and the trial and
contact forms get 15 submissions per hour for the entire world. As traffic grows
these limits will lock out real customers, and one abusive visitor can use up
the allowance for everyone.

## Evidence (all from the real server and the code)

| Fact | Where it was seen |
|---|---|
| Traefik logs `ClientHost: 10.0.1.1` for every request, including browsers | `/data/coolify/proxy/access.log` |
| nginx sees the real visitor (a public address) for the same requests | `/var/log/nginx/access.log` |
| Traefik overwrites the address nginx sends, because it does not trust `10.0.1.1` | Traefik log shows `request_X-Real-Ip: 10.0.1.1` |
| `app.set("trust proxy", 1)`, so Express reads one hop of `X-Forwarded-For` | `backend/server.js` |
| 17 limiters (`server.js` 7, `portalRoutes.js` 9, `mailRoutes.js` 1) all use the default key, `req.ip` | `rateLimit(` calls |
| The sign-in lockout is per account, not per address, so it is not affected | `createLoginThrottle` in `server.js` |
| `express-rate-limit` is 8.5.2 | `backend/package.json` |

Not yet measured, and worth measuring first: how often visitors are already
being refused. On the server:

```bash
grep -c '" 429 ' /var/log/nginx/access.log
```

```bash
zgrep -h '" 429 ' /var/log/nginx/access.log.* | awk '{print $7}' | sort | uniq -c | sort -rn | head
```

A high count, especially on `/api/portal/...` paths, means customers are
already being blocked by other customers' traffic.

## Prerequisite (already in progress, not part of this plan)

Traefik must be told to trust nginx so the real address survives the second hop:

```
--entrypoints.https.forwardedheaders.trustedips=10.0.1.1/32
--entrypoints.http.forwardedheaders.trustedips=10.0.1.1/32
```

After it, the Traefik log shows the real address in `request_X-Real-Ip`. To see
the exact `X-Forwarded-For` chain (needed below), `X-Forwarded-For` must also be
kept in the access log (Coolify's default config already keeps it).

## Options

**A. Raise `trust proxy` from 1 to 2 (recommended).** Express then reads the
real visitor from `X-Forwarded-For` two hops in: the chain becomes
`[anything the visitor sent], real visitor, 10.0.1.1`, and Express skips the two
trusted hops on the right and ignores everything to the left. Every limiter is
fixed at once with a one-line change, and `req.ip` becomes correct everywhere
(M-Pesa callback logs, audit fields). A visitor cannot forge it. A request that
bypasses nginx and hits Traefik directly gets its real address written by
Traefik, so it is not spoofable that way either.

**B. A custom key for each limiter using `X-Real-IP`.** Independent of hop
count, but 17 limiters to change, and anyone who can reach Traefik's published
ports directly (7080, 7443) could set `X-Real-IP` themselves and dodge limits.
Only worth it if A turns out not to work.

Either option should key IPv6 visitors by their /64 network, which
`express-rate-limit` v8 does through `ipKeyGenerator`, so one visitor cannot
get a fresh allowance by changing the last part of their IPv6 address.

## Order of work (each step is safe on its own)

1. **Measure** the 429 counts above and note them in the pull request.
2. **Confirm the chain.** After the Traefik change, read a few log lines and
   check `request_X-Forwarded-For` ends `real visitor, 10.0.1.1`. This proves
   `trust proxy = 2` is the right number before anything depends on it.
3. **Check the firewall.** Ports 7080 and 7443 should not be reachable from the
   internet, only from the server itself. If they are, close them (or restrict
   them to localhost) so nothing can skip nginx.
4. **Change `trust proxy` to 2**, with tests (below), in its own pull request.
5. **Check on the real site:** call a limited endpoint from two different
   networks (for example, your phone on mobile data and a laptop on Wi-Fi) and
   confirm they get separate allowances. The response headers
   `RateLimit-Remaining` show this.
6. **Retune the numbers** if step 1 showed the old budgets were too tight or too
   loose (see decisions).

The change is safe in either order with the Traefik change: with Traefik not yet
trusting nginx the chain is a single entry, and `trust proxy = 2` then returns
`10.0.1.1`, exactly as today. **Rollback** is changing the number back to 1.

## Tests

- Unit test with a tiny Express app and `trust proxy = 2`, sending crafted
  `X-Forwarded-For` chains over a real local socket:
  - `real, 10.0.1.1` gives `real`
  - `forged, real, 10.0.1.1` gives `real` (forged entries are ignored)
  - a single `10.0.1.1` gives `10.0.1.1` (today's behaviour, no regression)
  - IPv6 visitors in the same /64 share one allowance, different /64s do not
- Two visitors with different chains get independent counts on one limiter.
- The existing per-account lockout test (AUTH-02) must keep passing unchanged.
- The E2E skip (`skipInE2E`) stays exactly as it is.

## Risks and how they are handled

| Risk | Handling |
|---|---|
| Many Kenyan mobile users share one public address (carrier-grade NAT), so a per-address limit can block innocent people on the same carrier | See decision 2 |
| Limits tuned for "everyone shares one bucket" may now be too loose | Step 1 measurement, then step 6 |
| A wrong hop count would let visitors pick their own key | Step 2 proves the chain before the change, and the forged-chain test locks it in |
| The portal polls several endpoints per tab, so `apiLimiter` (120 per minute) could trip for a busy office behind one address | Step 1, and consider a higher ceiling for signed-in sessions |
| Traefik not trusting nginx yet | The change is a no-op until it does |

## Decisions that are yours

1. **Option A or B.** Recommended: A.
2. **Sign-in limit policy.** The sign-in lockout is already per account, which is
   the real defence against password guessing. Choose: keep the per-address
   limit at 20 per 15 minutes (strict, may block carrier-NAT users), raise it
   (for example 60), or key it by address and account together.
3. **Form limits.** The trial and contact forms allow 15 per hour per address.
   Keep, or loosen for shared networks?
4. **Whether to close ports 7080 and 7443** to the internet (step 3), if they
   are open.

## Out of scope

Redis-backed limiter storage (limits currently reset when the app restarts),
and a web application firewall. Both are worth separate plans.
