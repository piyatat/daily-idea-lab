#!/usr/bin/env bash
# Exit 0 when a run note exists for YYYY-MM-DD; exit 1 otherwise.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
runs="$root/runs"

if [[ ! -d "$runs" ]]; then
  exit 1
fi

date="${1:-}"
if [[ -z "$date" ]]; then
  echo "usage: $(basename "$0") YYYY-MM-DD" >&2
  exit 2
fi

if [[ ! "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "invalid date (expected YYYY-MM-DD): $date" >&2
  exit 2
fi

path="$runs/$date.md"
if [[ -f "$path" ]]; then
  exit 0
fi

exit 1
