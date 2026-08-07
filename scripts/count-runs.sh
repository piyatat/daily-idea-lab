#!/usr/bin/env bash
# Print the number of dated run notes under runs/.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
runs="$root/runs"

if [[ ! -d "$runs" ]]; then
  echo 0
  exit 0
fi

shopt -s nullglob
files=("$runs"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].md)
shopt -u nullglob

echo "${#files[@]}"
