# seqtax

Quantify **sequential tool-call tax** in agent session JSONL — missed parallel reads, duplicate calls, and stuck retry loops.

Bullet (YC S26, Aug 13) and DeepSeek Harness (Aug 13) both bet that agent speed is won in the **harness layer**, not the model. Independent reads executed one-after-another can waste 30–70% of wall-clock time. **seqtax** audits exported session logs offline and emits a deterministic speed receipt.

## Install

```bash
cd projects/seqtax
npm test
node bin/seqtax.js scan fixtures/sequential-reads.jsonl
```

Requires Node **22.13+**. Zero runtime dependencies.

## Commands

```bash
seqtax rules
seqtax scan <trace.jsonl> [--json] [--fail-on RULE1,RULE2]
```

## Rules

| ID | Severity | Trigger |
|----|----------|---------|
| `PARALLEL_GROUP` | medium | 2+ sequential read-only calls that could batch |
| `DUPLICATE_CALL` | high | Same tool+args fingerprint repeated in session |
| `STUCK_LOOP` | critical | Same tool+args invoked ≥3 times in a row |

## Input format

One JSON object per line (or a JSON array). Common shapes:

```json
{"type":"tool_call","tool":"Read","args":{"path":"src/cli.js"},"turn_id":1,"timestamp":"2026-08-14T10:00:00.000Z"}
{"type":"tool_use","name":"Grep","input":{"pattern":"export","path":"src"}}
{"role":"assistant","tool_calls":[{"name":"Glob","arguments":{"glob_pattern":"*.js"}}]}
```

Field aliases (`toolName`, `arguments`, `input`, nested `function.name`) are normalized automatically.

## Exit codes

- `0` — no findings (or findings outside `--fail-on` filter)
- `1` — one or more matching findings
- `2` — usage or parse error

## CI example

```yaml
- name: Sequential tool-call tax
  run: |
    node projects/seqtax/bin/seqtax.js scan artifacts/session.jsonl --fail-on PARALLEL_GROUP,STUCK_LOOP
```

## Portfolio fit

| Tool | Question it answers |
|------|---------------------|
| **agent-ledger** | What did the run cost? |
| **ghostroster** | Are subagents stale or orphaned? |
| **greensweep** | Did success produce output? |
| **dangertape** | Were tool calls destructive? |
| **seqtax** | How much latency tax came from serial tool scheduling? |

## License

MIT
