# greensweep

Catch agent runs that report **success** but produce **zero real output** — the silent-green failure mode.

Long-running agents (Grok 4.6, Managed Deep Agents, Cursor cloud runs) can finish green while doing nothing useful: no bytes written, no artifacts, no tool calls, only lifecycle chatter. Health checks and exit codes miss this. **greensweep** reads JSONL run receipts and flags the patterns.

## Install

```bash
cd projects/greensweep
npm test
node bin/greensweep.js scan fixtures/zero-bytes.jsonl
```

Requires Node **22.13+**. Zero runtime dependencies.

## Commands

```bash
greensweep rules
greensweep scan <run.jsonl> [--json] [--fail-on RULE1,RULE2]
```

## Rules

| ID | Severity | Trigger |
|----|----------|---------|
| `ZERO_BYTES` | critical | `status=success` with zero bytes and no artifacts |
| `MISSING_ARTIFACTS` | high | Success but expected outputs missing or empty |
| `NO_TOOL_CALLS` | high | Success with zero tool calls and zero files touched |
| `STATUS_ONLY` | medium | Only lifecycle/status events — no substantive work |

## Input format

One JSON object per line. Common field aliases are accepted:

```json
{
  "run_id": "run-42",
  "status": "success",
  "bytes_written": 4096,
  "artifacts": ["dist/report.json"],
  "tool_calls": 8,
  "files_touched": 2,
  "expects_artifacts": true,
  "events": ["plan: scope", "tool: edit", "verify: ok"]
}
```

## Exit codes

- `0` — no findings (or findings outside `--fail-on` filter)
- `1` — one or more matching findings
- `2` — usage or parse error

## CI example

```yaml
- name: Silent-green check
  run: |
    node projects/greensweep/bin/greensweep.js scan artifacts/run.jsonl --fail-on ZERO_BYTES,MISSING_ARTIFACTS
```

## Portfolio fit

| Tool | Question it answers |
|------|---------------------|
| **ops-canary** | Did the automation check in on time? |
| **agent-ledger** | What did the run cost? |
| **ghostroster** | Are subagents stale or orphaned? |
| **greensweep** | Did success actually produce output? |

## License

MIT
