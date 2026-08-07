#!/usr/bin/env bash
# List dated run notes under runs/ (newest first).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
runs="$root/runs"

if [[ ! -d "$runs" ]]; then
  echo "missing runs directory: $runs" >&2
  exit 1
fi

shopt -s nullglob
files=("$runs"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].md)
shopt -u nullglob

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No run notes yet. Create one with: ./scripts/new-run.sh" >&2
  exit 0
fi

# Sort by filename (YYYY-MM-DD) descending.
IFS=$'\n' sorted=($(printf '%s\n' "${files[@]}" | sort -r))
unset IFS

printf '%s\t%s\n' "date" "path"
for f in "${sorted[@]}"; do
  base="$(basename "$f" .md)"
  printf '%s\t%s\n' "$base" "$f"
done
