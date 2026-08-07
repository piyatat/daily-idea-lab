# pluginport

Pre-publish linter for [Agent Plugins 1.0.0](https://agent-plugins.org/) packages — validate `plugin.json` and `mcp.json`, audit skill quality, catch secret leaks, and print a cross-client portability matrix before you ship.

Shipped for the **Agent Plugins launch week** (Aug 6–7, 2026). Complements [mcplint](https://github.com/piyatat/mcplint) (MCP runtime/tool security) with **package-level** conformance checks.

## Install

```bash
npm install -g pluginport
# or run without installing:
npx pluginport check ./my-plugin
```

From source (in this monorepo checkout):

```bash
cd projects/pluginport
npm install
npm run build
node bin/pluginport.js check fixtures/valid-plugin
```

## Usage

```bash
# Full pre-publish audit
pluginport check ./my-plugin

# CI-friendly JSON + strict mode
pluginport check ./my-plugin --json --strict

# Cross-client MCP transport matrix
pluginport compat ./my-plugin --clients cursor,copilot,chatgpt
```

### What it checks

| Rule | Severity | Description |
|------|----------|-------------|
| `schema` | high | `plugin.json` / `mcp.json` vs official Agent Plugins 1.0.0 JSON Schemas |
| `schema-version` | high | Matching `$schema` versions across manifest and MCP config |
| `containment` | high/medium | Path escape, reserved env keys, missing stdio binaries |
| `secrets` | high/medium | Bearer tokens, API keys, plaintext HTTP to non-loopback hosts |
| `skills` | high/medium/low | Required `SKILL.md` frontmatter, vague descriptions, stub bodies |
| `portability` | high | sse-only plugins, missing stdio/streamable-http floor |

Exit `0` when clean (or no findings at `--fail-on` level). Exit `1` on failures.

## CI example

```yaml
- name: Lint Agent Plugin package
  run: npx pluginport check ./my-plugin --strict
```

## Related tools

- **[mcplint](https://github.com/piyatat/mcplint)** — static linter for MCP *tool* manifests (verbs, schemas, overlap)
- **Client validators** (Hanko, `claude plugin validate`) — target specific client layouts, not the portable Agent Plugins root contract

## License

MIT
