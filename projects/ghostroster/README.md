# ghostroster

Find **stale and orphaned subagents** in coding-agent session exports before they drain your quota. Local CLI, zero dependencies.

August 2026 reports show GPT-5.6 / Codex Desktop sessions burning weekly quotas on idle orchestration: completed subagents still marked `running`, 345-agent spawn cascades, and wait/status loops that re-meter full context every 10–30 seconds ([#37299](https://github.com/openai/codex/issues/37299), [#35463](https://github.com/openai/codex/issues/35463), [#37409](https://github.com/openai/codex/issues/37409)). **ghostroster** audits exported JSONL rollouts and flags quota-risk lifecycle patterns — it does **not** fix vendor bugs or claim exact dollar cost (see [agent-ledger](https://github.com/piyatat/agent-ledger) for cost autopsy).

## Install

```bash
cd projects/ghostroster
npm link   # optional global install
```

Requires Node 22.13+.

## Quick start

```bash
node bin/ghostroster.js scan path/to/session.jsonl
node bin/ghostroster.js scan rollout.jsonl --stale-hours 6 --fail
node bin/ghostroster.js scan rollout.jsonl --json > report.json
```

## What it detects

| Pattern | Severity | Meaning |
|---------|----------|---------|
| `ghost-open` | critical | `task_complete` recorded but spawn edge still open |
| `stale-running` | high/critical | Agent `running`/`open` with no activity past threshold |
| `deep-tree` | high/critical | Subagent nesting deeper than `--max-depth` |
| `poll-loop` | high/critical | Identical tool input repeated within 30 minutes |
| `orphan-spawn` | high | Spawned agent never ran tools, no terminal state |
| `post-done-churn` | medium | Tool calls after completion marker |

## Session format

JSONL (one event per line) or JSON array. Supports normalized exports with fields like:

```json
{"ts":"2026-08-11T08:00:00Z","type":"subagent_spawn","parent_id":"root","child_id":"explorer-1","task":"Scan auth"}
{"ts":"2026-08-11T08:05:00Z","type":"tool_call","agent_id":"explorer-1","tool":"Grep","input":"auth"}
{"ts":"2026-08-11T08:10:00Z","type":"task_complete","agent_id":"explorer-1"}
{"ts":"2026-08-11T08:11:00Z","type":"agent_status","agent_id":"explorer-1","status":"running"}
```

Event types recognized: `subagent_spawn`, `task_complete`, `turn_aborted`, `agent_status`, `tool_call` / `tool_use` (plus common alias fields).

## Options

```
ghostroster scan <session.jsonl> [options]

  --stale-hours <n>     Idle threshold for running agents (default: 24)
  --max-depth <n>       Max spawn tree depth (default: 5)
  --poll-threshold <n>  Identical tool repeats before flag (default: 5)
  --root-agent <id>     Root id for orphan root-level tools
  --json                JSON report
  --fail                Exit 1 on critical/high findings
```

## Safety boundary

- **Offline only** — reads files you pass in; no network, no vendor API.
- **Heuristic audit** — correlates with public GitHub reports; does not prove billing impact.
- **Complements** [dangertape](https://github.com/piyatat/dangertape) (destructive tool replay) and [agent-ledger](https://github.com/piyatat/agent-ledger) (token/cost autopsy).

## Test

```bash
npm test
npm run check
```

## License

MIT
