# Terminal broker (Phase 5.1–5.4)

A deliberately tiny, **non-internet-facing** service that is the only thing on
the box allowed to reach Docker (via a socket-proxy), so the payment-handling
backend never touches the docker socket. See the full rationale in
`../.claude/plans/how-does-one-create-deep-kazoo.md` §Phase 5.

## Capability chain (each hop drops power)

```
browser xterm.js
  → backend        (auth / ownership / Enterprise gate / mint broker token)   [P5.2]
  → broker /exec   (verify token → resolve by EXACT label → non-root exec)    [P5.3]
  → socket-proxy   (allowlist: containers list/inspect + exec only)           docker-compose.broker.yml
  → /var/run/docker.sock
```

The socket-proxy can't scope exec to a *specific* container — the Docker API
has no such filter. **Per-container authorization is enforced here**, in
`lib/resolve.js` (exact ownership match + refuse-on-ambiguity) plus a TOCTOU
re-inspect in `index.js`, run again immediately before every exec.

## What's built so far (and what's still missing)

- `lib/resolve.js` — exact-ownership container matching (the security core). Tested.
- `lib/token.js` — HMAC sign/verify with `BROKER_SIGNING_KEY`, distinct from the
  backend's `SESSION_SECRET`. Tested.
- `lib/exec.js` — **P5.3.** Builds the non-root, `setsid`-wrapped exec payload
  (`buildExecCreatePayload`) and enforces session caps — per-account (default 1),
  global (default 20), idle timeout (default 5 min), absolute timeout (default
  30 min) — via `SessionManager`, with injectable timers so it's fully unit
  tested without real waiting.
- `lib/dockerClient.js` — list/inspect/createExec/startExecStream via the proxy.
  The exec *stream* is a real hijacked-HTTP-connection implementation now, not a
  stub — but it has never run against a live Docker host (see the file's header
  warning). Any failure there must surface as a real error, never a fake shell.
- `index.js` — `GET /health` (always), `POST /resolve` (diagnostic, gated), and
  `GET/Upgrade /exec` (**the real shell bridge**): verifies the broker token,
  resolves + TOCTOU-rechecks the container, enforces session caps, opens a
  non-root exec, and bridges stdin/stdout between the browser WS and the Docker
  stream. Live-verified (from a dev machine, since these are pure gate checks
  that never need a real Docker host): wrong path → 404, feature disabled →
  503, missing broker key → 401, malformed/unresolvable token → 403 — all
  *before* any Docker call is attempted.
- **P5.4 — done.** Session recording: stdin/stdout chunks are captured
  in-memory per session (`recordChunk()`, capped at `TERMINAL_RECORDING_MAX_BYTES`,
  default 2MB — the live stream itself is never truncated, only what gets
  persisted) and flushed to S3-compatible storage at teardown
  (`lib/s3Upload.js`, a broker-local duplicate of the backend's SigV4 client —
  same "separate deploy image, separate creds" convention as `lib/token.js`).
  Session lifecycle is reported to the backend at start and end
  (`lib/backendReport.js`, POSTs to `BACKEND_INTERNAL_URL`, authenticated with
  the same `BROKER_API_KEY` used in the other direction) so the backend can
  write the `Terminal Session` doctype row without the broker ever holding
  Frappe credentials. `POST /sessions/:id/kill` (gated by `x-broker-key`, same
  as every other internal route) lets the backend's admin kill-switch
  terminate a live session by broker-assigned session id.
- **Still missing:** terminal **resize** (control-frame is parsed but not yet
  forwarded to Docker's resize API), and the **orphan-process reaper** (a
  `setsid`-wrapped shell dies with the session, but grandchildren re-parented
  to the container's PID 1 can still survive — "closing the tab is not a
  security boundary" until the reaper sweep exists).

## Env

| Var | Purpose |
|-----|---------|
| `TERMINAL_ENABLED` | Master gate. `false` (default) = 503/404 on everything but `/health`. |
| `BROKER_PORT` | Listen port (default 4600). |
| `BROKER_API_KEY` | Shared secret for the internal backend→broker calls (both `/resolve` and `/exec`). |
| `BROKER_SIGNING_KEY` | HMAC key for broker tokens. MUST differ from `SESSION_SECRET`. Broker refuses to start if `TERMINAL_ENABLED=true` and this is unset. |
| `DOCKER_PROXY_URL` | socket-proxy endpoint, e.g. `http://socket-proxy:2375`. |
| `TERMINAL_EXEC_USER` | Non-root `uid:gid` to exec as. Default `10001:10001` — **the tenant image must actually have this user**, or exec fails (which is the correct, safe failure mode — never falls back to root). |
| `TERMINAL_IDLE_MS` / `TERMINAL_ABSOLUTE_MS` | Session timeouts. Defaults 5 min / 30 min. |
| `TERMINAL_MAX_PER_ACCOUNT` / `TERMINAL_MAX_GLOBAL` | Concurrency caps. Defaults 1 / 20. |
| `BACKEND_INTERNAL_URL` | Where to POST session start/end reports. Unset = reporting silently no-ops (never blocks a live session). |
| `TERMINAL_S3_ENDPOINT` / `_BUCKET` / `_REGION` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | Off-box recording storage. Unset = recordings are captured in memory but never uploaded (dropped at teardown). |
| `TERMINAL_RECORDING_MAX_BYTES` | In-memory recording cap per session. Default 2MB. |

## Run / test

```
npm install && npm start          # local (needs DOCKER_PROXY_URL for /resolve and /exec)
npm test                          # pure unit tests (resolve + token + exec/session caps), no Docker
docker compose -f ../docker-compose.broker.yml up   # full stack (VPS)
```

## Verification

**From a dev machine (no Docker needed — pure gate/auth checks):**
- `/exec` upgrade: wrong path → 404, `TERMINAL_ENABLED` unset → 503, missing/wrong
  `x-broker-key` → 401, malformed or bad-signature token → 403 (rejected before
  any Docker call). All confirmed working.

**From the VPS only (first real exercise of `createExec`/`startExecStream`):**
1. `docker compose -f docker-compose.broker.yml up` with `TERMINAL_ENABLED=false`
   → `curl broker:4600/health` returns `{"ok":true,"enabled":false}`.
2. Flip `TERMINAL_ENABLED=true`. Mint a real broker token for a throwaway
   test container (same job-based pattern as the earlier Coolify verification
   scripts), connect a WS client to `/exec`, confirm: the shell opens as the
   configured non-root user (`whoami`/`id` inside), a fork bomb / `dd` stays
   bounded by the P5.0 container caps (doesn't affect the host or siblings),
   closing the WS actually kills the shell process, and a second session for
   the same account is rejected (`ACCOUNT_CAP`) while the first is open.
3. Confirm the ownership-resolution failure mode too: mint a token for a
   name that doesn't match any running container and confirm `/exec` 403s
   rather than falling back to any other container.
