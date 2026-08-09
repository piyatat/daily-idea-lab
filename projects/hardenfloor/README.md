# hardenfloor

Fail-closed auditor for coding-agent **permission and sandbox minimum floors**.

It grades project Claude Code settings (and optionally Codex `config.toml`) against a deterministic security floor, and flags ChainDrop-style persistence hooks that turn opening a repo into code execution.

No dependencies. No API keys. No network.

## Why

In August 2026, agent security attention shifted from “lint the plugin” to **architectural controls**: sandboxes, default-deny egress, credential deny lists, and credential brokers (UnYOLO). At the same time, the ChainDrop npm worm showed that `.claude/settings.json` SessionStart hooks and VS Code `folderOpen` tasks can reinfect a machine after packages are cleaned.

`hardenfloor` is a small CI-friendly check that fails closed when those floors are missing or intentionally YOLO’d.

## Requirements

Node.js 20 or newer.

## Usage

```bash
# From a project directory
node bin/hardenfloor.js check

# Explicit path + JSON for CI
node bin/hardenfloor.js check ./my-app --json

# Also audit a Codex config
node bin/hardenfloor.js check ./my-app --codex ~/.codex/config.toml

# List the rule profile
node bin/hardenfloor.js rules --json
```

Install locally for the short command:

```bash
npm link
hardenfloor check
```

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Floor satisfied (warnings allowed) |
| 1 | One or more error-level floor failures |
| 2 | Usage or I/O error |

## What it checks

### Claude Code (`.claude/settings.json`)

| Rule | Severity | Failure condition |
| --- | --- | --- |
| `CLAUDE_PERMISSIVE_MODE` | error | `permissions.defaultMode` is `bypassPermissions` or `dontAsk` |
| `CLAUDE_SKIP_DANGEROUS_PROMPT` | error | `skipDangerousModePermissionPrompt: true` in project settings |
| `CLAUDE_SANDBOX_DISABLED` | error | `sandbox.enabled` is not `true` |
| `CLAUDE_ALLOW_UNSANDBOXED` | error | `allowUnsandboxedCommands` is not `false` |
| `CLAUDE_SANDBOX_SOFT_FAIL` | warn | `failIfUnavailable` is not `true` |
| `CLAUDE_EMPTY_EGRESS` | error | sandbox network allowlist empty/missing |
| `CLAUDE_MISSING_SECRET_DENY` | error | `permissions.deny` missing `.env` / home credential `Read(...)` rules |
| `CLAUDE_MISSING_CREDENTIALS_BLOCK` | warn | `sandbox.credentials.files` missing common credential paths |
| `CLAUDE_CHAINEDROP_HOOK` | error | `SessionStart` runs repo-local `setup.mjs` / `setup.js` |
| `CLAUDE_SETTINGS_MISSING` | error | no project settings file (fail-closed) |

### VS Code (`.vscode/tasks.json`)

| Rule | Severity | Failure condition |
| --- | --- | --- |
| `VSCODE_CHAINEDROP_TASK` | error | `folderOpen` task launches repo-local setup script |

### Codex (`--codex`)

| Rule | Severity | Failure condition |
| --- | --- | --- |
| `CODEX_APPROVAL_NEVER` | error | `approval_policy = "never"` |
| `CODEX_SANDBOX_FULL_ACCESS` | error | `sandbox_mode` is full/danger access |
| `CODEX_NETWORK_OPEN` | warn | workspace `network_access` enabled |

## Example (safe floor)

```json
{
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "failIfUnavailable": true,
    "network": { "allowedDomains": ["registry.npmjs.org", "github.com"] },
    "credentials": {
      "files": [
        { "path": "~/.ssh", "mode": "deny" },
        { "path": "~/.aws", "mode": "deny" },
        { "path": ".env", "mode": "deny" }
      ]
    }
  },
  "permissions": {
    "defaultMode": "default",
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(~/.ssh/**)",
      "Read(~/.aws/**)"
    ]
  }
}
```

## Development

```bash
npm test
npm run check
```

## License

MIT
