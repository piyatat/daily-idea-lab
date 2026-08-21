# buildref

Fail-closed linter for **Rust build-script supply-chain bait** — the attack class highlighted by the August 2026 **arrayref** incident on Hacker News.

Build scripts run at compile time with network and shell access. Malicious crates hide payloads in `build.rs`, bait `build-dependencies`, or ghost lockfile pins. `buildref` scans offline before you approve a dependency bump or CI build.

## Install

```bash
cd projects/buildref
npm test
node bin/buildref.js scan /path/to/rust/project
```

Requires Node **22.13+**. Zero runtime dependencies.

## Commands

| Command | Purpose |
|---------|---------|
| `buildref scan [path]` | Scan `Cargo.toml`, `build.rs`, and `Cargo.lock` |
| `buildref rules` | List rule IDs and severities |
| `buildref explain <rule>` | Remediation guidance |

### Flags

- `--json` — machine-readable report
- `--fail-on RULE1,RULE2` — exit 1 when listed rules fire (default: all `error` rules)

## Rules

| Rule | Severity | Detects |
|------|----------|---------|
| `BUILD_NET_FETCH` | error | Network primitives in `build.rs` (`TcpStream`, `reqwest`, etc.) |
| `BUILD_SHELL_EXEC` | error | `Command::new`, shell outs |
| `BUILD_ENV_EXFIL` | warn | Reads of token-like env vars during build |
| `LOCK_BAIT_BUILD_DEP` | error | Bait/typosquat crates in build-deps or lockfile |
| `PROC_MACRO_BUILD_CHAIN` | error | build.rs + suspicious non-standard build-dep chain |

## Context

On **2026-08-20**, a malicious **arrayref** crate version shipped a build-time payload. crates.io deleted the version without a yank flag; `cargo audit` missed it. This tool complements `cargo audit` with **build-surface** heuristics you can gate in CI today.

Related tools in the piyatat portfolio: **trapdeck** (npm script bait), **hardenfloor** (agent permission floors), **mcplint** (MCP manifests).

## Example

```bash
buildref scan fixtures/arrayref-style
# [error] BUILD_NET_FETCH: ...
# [error] BUILD_SHELL_EXEC: ...
# [error] LOCK_BAIT_BUILD_DEP: ...
```

## License

MIT
