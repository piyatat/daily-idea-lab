# dsplug

Linter for **DeepSeek Harness** (`dsh`) Cordis plugin bundles — catch broken `cordis.patch.yml` rows, missing manifest links, and unresolved profile stack overrides before you boot an agent harness.

Zero dependencies. Node 22.13+.

## Why

DeepSeek Harness launched Aug 13, 2026 with a plugin-first Cordis architecture: every model adapter, tool registry, and agent loop is a swappable bundle layer. Community plugins are exploding (`dsh-plugin` topic), but a typo in row ids or an override targeting a missing layer fails late at runtime.

`dsplug` validates:

- `package.json` **`dsh.bundle.patch`** paths resolve
- **`cordis.patch.yml`** insert rows have `id` + scoped npm `name`
- Duplicate row ids inside a patch
- Ordered **stack** checks: `- id: foo` overrides must exist in earlier layers

Complements [pluginport](https://github.com/piyatat/pluginport) (Agent Plugins 1.0.0) — this tool is **dsh/Cordis-specific**.

## Install

From this monorepo checkout:

```bash
cd projects/dsplug
npm link   # optional: global dsplug
```

## Usage

```bash
# Validate a dsh plugin/bundle package directory
dsplug check ./my-dsh-plugin

# Validate a standalone patch file
dsplug patch ./cordis.patch.yml

# Simulate profile bundle order (base → mode → user overlay)
dsplug stack ./base.patch.yml ./headless.patch.yml ./user.patch.yml

dsplug rules
dsplug check . --json --fail-on DUPLICATE_ROW_ID,UNRESOLVED_TARGET
```

## Rules

| ID | Severity | Description |
| --- | --- | --- |
| `DUPLICATE_ROW_ID` | error | Same row id declared twice in one patch |
| `MISSING_PATCH_FILE` | error | `dsh.bundle.patch` path missing |
| `MISSING_ROW_ID` | error | Insert row without `id` |
| `MISSING_ROW_NAME` | error | Insert row without npm `name` |
| `EMPTY_INSERT` | error | `- insert:` block has no rows |
| `UNRESOLVED_TARGET` | error | Override `- id:` not in earlier stack layers |
| `UNSCOPED_PLUGIN_NAME` | warning | `name` not `@scope/pkg` |
| `ORPHAN_PATCH` | warning | `cordis.patch.yml` without `dsh` metadata |

## Test

```bash
npm test
npm run check
```

## License

MIT
