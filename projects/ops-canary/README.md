# Ops Canary

Payload-free heartbeat monitoring for small teams running important Zapier, Make, n8n, or webhook automations.

Ops Canary records only that an opaque monitor received an optional event ID at a particular time. It detects:

- `on-time` — the latest heartbeat arrived within its expected window
- `late` — the latest heartbeat arrived after its deadline and grace period
- `missing` — no heartbeat was observed despite continuous receiver uptime
- `duplicate` — the same event ID was observed more than once
- `unknown` — no receipt baseline exists or receiver uptime was insufficient to judge the window

It deliberately does **not** claim that an automation succeeded, processed the right payload, or produced the correct downstream effect.

## Quick start

Requires Node.js 22.13 or newer. There are no package dependencies.

```bash
npm link
ops-canary add daily-invoice-sync --every 1d --grace 15m
ops-canary serve
```

The `add` command prints a one-time bearer token and a local endpoint:

```text
http://127.0.0.1:8787/api/heartbeat/daily-invoice-sync
```

Call it as the final side-effect-free step in a canary workflow:

```bash
curl -X POST \
  -H 'Authorization: Bearer <opaque-token>' \
  -H 'X-Ops-Event-Id: scheduled-run-2026-08-10' \
  'http://127.0.0.1:8787/api/heartbeat/daily-invoice-sync'
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787) for the dashboard. The JSON status endpoint is `/api/monitors`.

Store the bearer token as a workflow secret. Use a stable, non-sensitive `X-Ops-Event-Id` to detect redelivery. Do not put payload data in it.

## Data minimization

- Requests with bodies are rejected before receipt metadata is recorded; bodies are never parsed or stored.
- Monitor tokens are stored as one-way SHA-256 hashes.
- Event IDs are stored as HMAC digests rather than plaintext. Because the local HMAC key shares the database, this is data minimization—not protection from an attacker who has the database.
- Event metadata defaults to seven days of retention or two expected intervals, whichever is longer. Expired rows are pruned on receipt and status reads.
- The server binds to `127.0.0.1` by default and makes no outbound requests.
- An invalid monitor or token gets the same `404` response.

The SQLite database defaults to `./ops-canary.db`. Override it with `--db <path>` or `OPS_CANARY_DB`.

## Commands

```text
ops-canary add <id> --every <duration> [--grace <duration>] [--retention <duration>]
ops-canary list
ops-canary serve [--port 8787]
```

Durations accept `ms`, `s`, `m`, `h`, and `d`, such as `30s`, `5m`, or `1d`.

`ops-canary list` is conservative: because a short-lived CLI process cannot prove receiver continuity, an overdue window is `unknown`. The running receiver can classify it as `missing` only when it observed the full window.

## Test

```bash
npm run check
npm test
```

The tests cover deadline boundaries, duplicate detection, restart and pause uncertainty, authentication, event-ID hashing, payload non-retention, disk persistence, retention, and the local HTTP dashboard.

## Limits

A heartbeat can prove only that the Ops Canary receiver observed a request. A green canary route does not establish:

- delivery or correctness of real business payloads
- successful processing by intermediate or downstream services
- correct amounts, recipients, mappings, or side effects
- availability of the source system

Use a dedicated, side-effect-free canary workflow. Do not route real customer payloads through Ops Canary.
