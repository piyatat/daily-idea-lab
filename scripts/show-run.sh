#!/usr/bin/env bash
# Print path to a dated run note (YYYY-MM-DD); exit 1 if missing.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
runs="$root/runs"

if [[ ! -d "$runs" ]]; then
  echo "missing runs directory: $runs" >&2
  exit 1
fi

date="${1:-}"
if [[ -z "$date" ]]; then
  echo "usage: $(basename "$0") YYYY-MM-DD" >&2
  exit 1
fi

if [[ ! "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "invalid date (expected YYYY-MM-DD): $date" >&2
  exit 1
fi

path="$runs/$date.md"
if [[ ! -f "$path" ]]; then
  echo "No run note for $date (expected $path)" >&2
  exit 1
fi

printf '%s\n' "$path"
