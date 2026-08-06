# agent-ledger

Autopsy coding-agent session logs — cost by route, cache gaps, and a permission-gated digest. Local CLI, no API keys.

August 2026 teams spend $50–300/user/month on coding agents, but most have no session-level view of where tokens went, which turns should have used a cheaper model, or when prompt-cache gaps re-billed full context. **agentledger** parses exported session JSONL and prints an actionable autopsy in one command.

## Install

```bash
npm install -g agent-ledger
# or clone and link
git clone https://github.com/piyatat/agent-ledger.git
cd agent-ledger && npm install && npm link
```

## Quick start

```bash
agentledger analyze fixtures/sample-session.jsonl
agentledger analyze ./my-session.jsonl --policy policy.yaml
agentledger analyze ./my-session.jsonl --json -o report.json
agentledger analyze ./my-session.jsonl --csv -o turns.csv
```

## Session format

JSONL (one turn per line) or a JSON array. Each turn:

```json
{
  "ts": "2026-08-06T10:00:00Z",
  "model": "claude-opus-5",
  "tools": ["Read", "Grep"],
  "content": "optional hint for classification",
  "usage": {
    "input": 42000,
    "output": 800,
    "cacheRead": 38000
  }
}
```

Also accepts OpenAI-style field names (`input_tokens`, `prompt_tokens`, `tool_calls`).

## What you get

| Output | Description |
| --- | --- |
| **Cost summary** | Actual vs recommended tier routing savings |
| **Turn mix** | explore / plan / implement / review breakdown |
| **Cache gaps** | Turns after >5 min idle (likely cache miss) |
| **Policy digest** | Actions that would pause under `policy.yaml` |
| **Per-turn table** | Model, routed model, cost, tools |

## Policy file

```yaml
max_session_usd: 2.00
require_review:
  - git push
  - rm -rf
  - curl
```

Exit code `1` when policy violations or budget exceeded — CI-friendly.

## Routing heuristics (v0)

| Turn kind | Detected by | Recommended model |
| --- | --- | --- |
| explore | Read, Grep, Glob, Search | economy (Haiku / mini) |
| implement | Write, Edit, Shell | standard (Sonnet) |
| plan / review | long content or keywords | frontier (Opus) |

Pricing table is indicative Aug 2026 list prices for estimates only.

## Related tools

- [agentbrief](https://github.com/piyatat/agentbrief) — token-budgeted context briefs before a session
- [ruleradar](https://github.com/piyatat/ruleradar) — AGENTS.md token tax by path
- [diffguard](https://github.com/piyatat/diffguard) — post-session diff risk scan

## License

MIT
