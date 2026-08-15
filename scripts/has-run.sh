#!/usr/bin/env bash
# Exit 0 when a run note exists for YYYY-MM-DD; exit 1 otherwise.
# With no date, checks today's run (for daily automation / CI).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
runs="$root/runs"

if [[ ! -d "$runs" ]]; then
  exit 1
fi

date="${1:-$(date +%Y-%m-%d)}"
if [[ -n "${1:-}" && ! "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "invalid date (expected YYYY-MM-DD): $date" >&2
  exit 2
fi

path="$runs/$date.md"
if [[ -f "$path" ]]; then
  exit 0
fi

exit 1
