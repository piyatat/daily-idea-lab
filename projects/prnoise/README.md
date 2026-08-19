# prnoise

Fail-closed linter for **AI;DR** PR prose — bloated agent descriptions, template theater, and missing risk signals.

August 2026's review crisis: PR volume up 98%, review wait up 91%, and maintainers drowning in 100+ line AI-generated descriptions nobody reads. `prnoise` catches the patterns before you open the PR.

Zero dependencies. Node 22.13+.

## Install

```bash
cd projects/prnoise
npm link   # or: node bin/prnoise.js lint fixtures/minimal-human.pr.md
```

## Usage

```bash
# Lint a saved PR body
prnoise lint description.md

# Pipe from GitHub CLI
gh pr view 42 --json body -q .body | prnoise lint - --diff-lines 24

# CI gate (fail on error-severity rules)
prnoise lint body.md --diff-lines 50 --json

# Fail on specific rules
prnoise lint body.md --fail-on PROSE_SLOP_PACK,TEMPLATE_TRIFECTA,VACUUM_RISK_SECTION

# List rules / remediation
prnoise rules
prnoise explain VACUUM_RISK_SECTION
```

## Rules

| ID | Severity | What it catches |
|----|----------|-----------------|
| `DOC_TO_CODE_RATIO` | error | Body lines ≫ diff lines (needs `--diff-lines`) |
| `DESC_LENGTH_VS_DIFF` | warn | 200+ line body for tiny change |
| `BOILERPLATE_SECTIONS` | warn | ≥3 formulaic sections (Summary/Testing/Notes…) |
| `PROSE_SLOP_PACK` | warn | ≥5 marketing slop phrases |
| `TEMPLATE_TRIFECTA` | error | Hollow Summary + Testing + Checklist shell |
| `CHECKED_BOX_THEATER` | warn | ≥4 checked boxes, zero open items |
| `VACUUM_RISK_SECTION` | error | Risk section empty or "None/N/A" |
| `MISSING_NOT_TESTED` | warn | Testing section without "not tested" on large diffs |
| `UNCERTAINTY_SILENCE` | warn | Long body with zero uncertainty markers |
| `HEADING_STUFFING` | warn | >8 H2/H3 headings in <150 lines |

Default `--fail-on`: error-severity rules only. Use `--fail-on warn` style by listing specific rule IDs.

## Test

```bash
npm test
npm run check
```

## Related

- [diffguard](https://github.com/piyatat/diffguard) — git **diff** risk (hotspots, secrets)
- **prnoise** — PR **body** prose noise (this tool)

Complementary, not overlapping.

## License

MIT
