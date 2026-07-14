# Terminal broker (Phase 5.1 scaffolding)

A deliberately tiny, **non-internet-facing** service that is the only thing on
the box allowed to reach Docker (via a socket-proxy), so the payment-handling
backend never touches the docker socket. See the full rationale in
`../.claude/plans/how-does-one-create-deep-kazoo.md` §Phase 5.

## Capability chain (each hop drops power)

```
browser xterm.js
  → backend        (auth / ownership / Enterprise gate / mint broker token)   [P5.2]
  → broker         (verify token → resolve container by EXACT label → exec)   [this dir]
  → socket-proxy   (allowlist: containers list/inspect + exec only)           docker-compose.broker.yml
  → /var/run/docker.sock
```

The socket-proxy can't scope exec to a *specific* container — the Docker API
has no such filter. **Per-container authorization is enforced here**, in
`lib/resolve.js` (exact ownership match + refuse-on-ambiguity) plus a TOCTOU
re-inspect in `index.js`.

## What P5.1 includes (and deliberately does not)

- `lib/resolve.js` — exact-ownership container matching (the security core). Tested.
- `lib/token.js` — HMAC sign/verify with `BROKER_SIGNING_KEY`, distinct from the
  backend's `SESSION_SECRET`. Tested.
- `lib/dockerClient.js` — list/inspect via the proxy. `execStream()` is a
  **stub that throws** — the real hijacked PTY stream lands in **P5.3**.
- `index.js` — HTTP `/health` (always) + `/resolve` (diagnostic, gated). The WS
  `upgrade` returns **501** until P5.2/P5.3 wire mint + jail + recording.
- Everything is inert unless `TERMINAL_ENABLED=true` **and** a valid
  `BROKER_API_KEY` is presented — and even then only `/resolve` (no exec) works.

## Env

| Var | Purpose |
|-----|---------|
| `TERMINAL_ENABLED` | Master gate. `false` (default) = 503 on everything but `/health`. |
| `BROKER_PORT` | Listen port (default 4600). |
| `BROKER_API_KEY` | Shared secret for the internal backend→broker calls. |
| `BROKER_SIGNING_KEY` | HMAC key for broker tokens. MUST differ from `SESSION_SECRET`. Broker refuses to start if `TERMINAL_ENABLED=true` and this is unset. |
| `DOCKER_PROXY_URL` | socket-proxy endpoint, e.g. `http://socket-proxy:2375`. |

## Run / test

```
npm install && npm start          # local (needs DOCKER_PROXY_URL for /resolve)
npm test                          # pure unit tests (resolve + token), no Docker
docker compose -f ../docker-compose.broker.yml up   # full stack (VPS)
```

## Verification (P5.1, from the VPS — not a dev machine)

1. `docker compose -f docker-compose.broker.yml up` with `TERMINAL_ENABLED=false`
   → `curl broker:4600/health` returns `{"ok":true,"enabled":false}`.
2. Flip `TERMINAL_ENABLED=true`, mint a token with `lib/token.js sign(...)` for a
   real container's `resourceName`, `POST /resolve` with `x-broker-key` →
   confirm it returns that container's id, and that a token for a **non-existent**
   or **prefix** name returns `NO_MATCH`/refuses. Then tear down. No shell opens
   at this phase (WS upgrade = 501 by design).
