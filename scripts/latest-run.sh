#!/usr/bin/env bash
# Print the path to the newest dated run note (stdout only; for scripting).
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
  exit 1
fi

latest="$(printf '%s\n' "${files[@]}" | sort -r | head -n 1)"
printf '%s\n' "$latest"
