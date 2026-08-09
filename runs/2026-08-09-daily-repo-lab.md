# Daily repo lab — 2026-08-09

Cron run at 03:01 UTC. Gap-fill ingest (10) + repo iterate (10). No in-session `/loop`.

## Knowledge ingest (gap-fill batch 2)

Corpus grew 27 → 37 entries. `npm run check` passed locally. Commit `8e2fb69` on branch `cursor/daily-ingest-2026-08-09-batch2` (push blocked — see Failures).

| id | title |
| --- | --- |
| `mcp-transport-stdio-http` | MCP transport — stdio vs Streamable HTTP |
| `parallel-tool-calls` | Parallel tool calls in agent loops |
| `git-safety-for-agents` | Git safety guardrails for coding agents |
| `durable-agent-workflows` | Durable workflows and checkpoint recovery |
| `model-routing-failover` | LLM routing and provider failover |
| `mcp-resources-prompts` | MCP resources and prompts (beyond tools) |
| `browser-computer-use-agents` | Browser and computer-use agents — production patterns |
| `background-cron-agents` | Background and cron-scheduled agents |
| `workspace-path-boundaries` | Workspace path and sandbox boundaries |
| `streaming-tool-dispatch` | Streaming tool dispatch (eager / pipelined execution) |

Note: batch 1 (10 notes, same date) was already on `main` before this run (`2348bbf`).

## Repo iterate

Local commits on `cursor/daily-improve-20260809`. Push denied for all targets except this repo (cursor[bot] lacks write on `piyatat/*`).

| # | repo | improvement | SHA | pushed |
| ---: | --- | --- | --- | --- |
| 1 | otel-sieve | `validate` alias for `check` | `27f1aef` | no |
| 2 | agent-ledger | `--summary` one-line CI output | `3e5eb0f` | no |
| 3 | pluginport | `npm test` fixture smoke script | `c4466f0` | no |
| 4 | mcplint | `--list-rules` flag | `67651e9` | no |
| 5 | diffguard | `unsafe-dynamic-code` rule (eval / new Function) | `2068faa` | no |
| 6 | signal-drift | `?` / `/` keyboard help | `e37e6e0` | no |
| 7 | agentbrief | `--summary` stderr line | `b960d1f` | no |
| 8 | orbitdesk | `?` / `/` keyboard help | `ea3713f` | no |
| 9 | lockplain | `-V` version alias | `e47f59a` | no |
| 10 | ruleradar | Escape clears path inputs | `07554ce` | no |

Verification: `npm test` / `npm run build` passed locally for all touched repos.

## Failures

- **Push 403**: `cursor[bot]` can push `piyatat/daily-idea-lab` only. All other repo pushes returned `Permission denied` (agent-knowledge + 10 iterate repos). Commits exist locally on VM clones under `/home/ubuntu/repos/`.

## This repo

- Run note: this file on branch `cursor/daily-repo-lab-workflow-4695`.
