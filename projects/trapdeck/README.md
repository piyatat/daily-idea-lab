# trapdeck

Pre-approval npm/pnpm script expander for agent command gates. Expands `npm run …` chains **before** a human approves and flags bait patterns like the approval-game **npm run setup** trap.

Zero dependencies. Deterministic. Fixture-testable.

## Why

HN's agent approval game (Aug 12) showed **1/3 of dangerous commands get approved** — often because `npm run setup` looks benign until postinstall/curl|bash chains expand. No piyatat repo does **pre-execution static expansion** (`dangertape` is post-hoc replay; `hardenfloor` is permission floors).

## Commands

```bash
# Expand one proposed command against a repo's package.json
trapdeck expand "npm run setup" --dir .

# Scan every script in package.json
trapdeck scan [dir]

# List bait rules
trapdeck rules [--json]
```

## Bait rules (v1)

| Rule | Severity | Trigger |
|------|----------|---------|
| `SETUP_TRAP` | error | setup/init/bootstrap expands into lifecycle, fetch, or hidden node |
| `LIFECYCLE_HOOK` | error | postinstall/prepare/etc. in expansion chain |
| `REMOTE_PIPE_SHELL` | error | curl/wget piped to sh/bash |
| `REMOTE_FETCH` | warning | curl/wget in expanded text |
| `HIDDEN_NODE` | error | node on `.claude/`, `.vscode/`, `/tmp/` paths |
| `SECRET_TOUCH` | error | touches `~/.ssh`, `.env`, etc. |
| `NESTED_RUN_DEPTH` | warning | npm run nesting depth ≥ 3 |
| `NPX_REMOTE` | warning | `npx --yes` unpinned remote exec |

## Exit codes

- `0` — no error-severity findings
- `1` — error-severity bait detected
- `2` — usage / I/O error

## Develop

```bash
cd projects/trapdeck
npm test      # 13 fixture tests
npm run check # syntax check
```

## Overlap

- **dangertape** — replays executed tool calls after the fact
- **hardenfloor** — audits permission/sandbox floors in agent configs
- **mcplint** — MCP manifest linting

trapdeck sits **upstream of approval UI**: show the expanded chain, then let the human decide.
