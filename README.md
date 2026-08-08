# daily-idea-lab

Home base for the daily Cursor cloud automation that:

1. Scouts what people are paying attention to right now
2. Runs a multi-agent debate to pick one candidate project
3. Creates a new repo under `piyatat` **or** improves an overlapping existing repo
4. Implements the chosen work

This repository is the automation’s checkout root. Implemented projects live in their own repos; notes from each run may be recorded under [`runs/`](runs/).

## Recording a run

```bash
chmod +x scripts/new-run.sh   # once
./scripts/new-run.sh          # creates runs/YYYY-MM-DD.md from the template
./scripts/new-run.sh 2026-08-07   # optional explicit date
```

The script refuses to overwrite an existing note. Fill in scout highlights, debate outcome, and result after the automation finishes.

List existing notes (newest first):

```bash
./scripts/list-runs.sh
```

Print the newest run note path (for editors / automation):

```bash
chmod +x scripts/latest-run.sh   # once
./scripts/latest-run.sh
```

Count run notes (one integer, for dashboards / CI):

```bash
chmod +x scripts/count-runs.sh   # once
./scripts/count-runs.sh
```

Print the path to a specific run note by date:

```bash
chmod +x scripts/show-run.sh   # once
./scripts/show-run.sh 2026-08-07
```
