#!/usr/bin/env bash
# Create today's run note from runs/_TEMPLATE.md (no overwrite).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
runs="$root/runs"
template="$runs/_TEMPLATE.md"
date="${1:-$(date +%Y-%m-%d)}"
out="$runs/$date.md"

if [[ ! -f "$template" ]]; then
  echo "missing template: $template" >&2
  exit 1
fi

if [[ -e "$out" ]]; then
  echo "already exists: $out" >&2
  exit 1
fi

# Fill the YYYY-MM-DD placeholder in the H1; leave the rest for the run.
sed "s/YYYY-MM-DD/$date/g" "$template" >"$out"
echo "created $out"
