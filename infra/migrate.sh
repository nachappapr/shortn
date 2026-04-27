#!/usr/bin/env bash
set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://shortn:shortn@localhost:5432/shortn}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-migrations}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found on PATH" >&2
  exit 1
fi

shopt -s nullglob
files=("$MIGRATIONS_DIR"/*.sql)
if [ ${#files[@]} -eq 0 ]; then
  echo "No migration files found in $MIGRATIONS_DIR"
  exit 0
fi

for f in "${files[@]}"; do
  echo "→ applying $f"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "✓ all migrations applied"
