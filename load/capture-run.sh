#!/usr/bin/env bash
# Run a k6 script and capture this run's chunk timings only.
#
#   ./load/capture-run.sh load/k6/m4-batch-test.js
#   LABEL=vus-12 ./load/capture-run.sh load/k6/m4-batch-test.js --vus 12
#
# Any extra args are passed straight through to `k6 run`.
# Env: LABEL (default: k6 script basename), SETTLE_SECS (default 10).
#
# Scopes logs with `docker compose logs --since <elapsed>s` so old runs sitting
# in the same container's json-file log don't bleed into the results.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$REPO_ROOT/infra/docker/docker-compose.yml"
RESULTS="$REPO_ROOT/load/k6/results"

K6_SCRIPT="${1:?usage: capture-run.sh <k6-script> [k6 args...]}"
shift

LABEL="${LABEL:-$(basename "$K6_SCRIPT" .js)}"
SETTLE_SECS="${SETTLE_SECS:-10}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
PREFIX="$RESULTS/${LABEL}-${STAMP}"

mkdir -p "$RESULTS"

T0=$(date +%s)
echo "==> $LABEL  (run at ${STAMP}Z)"

set +e
k6 run "$K6_SCRIPT" "$@" 2>&1 | tee "${PREFIX}-k6.txt"
K6_RC=${PIPESTATUS[0]}
set -e

# The batch worker cron fires every 2s, so chunks land after k6 has exited.
echo "==> waiting ${SETTLE_SECS}s for the worker to drain chunks"
sleep "$SETTLE_SECS"

# Relative --since (rather than an absolute UTC stamp) keeps this correct even
# if the host and the Docker VM clocks have drifted apart.
ELAPSED=$(( $(date +%s) - T0 + 2 ))

capture() {
  local event="$1" out="$2" fields="$3" header="$4"
  local body="${out}.body"
  # logger() nests the event JSON as an escaped string inside .message, so the
  # payload needs a second fromjson. fromjson? skips plain-string log lines.
  docker compose -f "$COMPOSE" logs --no-log-prefix --since "${ELAPSED}s" app 2>/dev/null \
    | { grep -F "$event" || true; } \
    | jq -R -r "fromjson? // empty
                | . as \$o
                | (.message | fromjson? // empty)
                | select(.event == \"$event\")
                | [$fields] | @tsv" \
    | sort > "$body"
  { printf '%s\n' "$header"; cat "$body"; } > "$out"
  rm -f "$body"
}

capture chunk_ok "${PREFIX}-chunks.tsv" \
  '$o.timestamp, .jobId, .chunk, .durationMs, $o.instanceId' \
  "$(printf 'timestamp\tjobId\tchunk\tdurationMs\tinstanceId')"

capture chunk_failed "${PREFIX}-failed.tsv" \
  '$o.timestamp, .jobId, .chunk, .durationMs, $o.instanceId, .error' \
  "$(printf 'timestamp\tjobId\tchunk\tdurationMs\tinstanceId\terror')"

OK=$(( $(wc -l < "${PREFIX}-chunks.tsv") - 1 ))
FAILED=$(( $(wc -l < "${PREFIX}-failed.tsv") - 1 ))

echo
echo "==> $OK chunk_ok, $FAILED chunk_failed"
if [ "$OK" -gt 0 ]; then
  tail -n +2 "${PREFIX}-chunks.tsv" | cut -f4 | sort -n | awk '
    { d[NR] = $1; sum += $1 }
    END {
      p50 = d[int((NR + 1) * 0.50)]; if (p50 == "") p50 = d[NR]
      p95 = d[int((NR + 1) * 0.95)]; if (p95 == "") p95 = d[NR]
      printf "    durationMs  min=%d  p50=%d  p95=%d  max=%d  mean=%.1f\n", \
        d[1], p50, p95, d[NR], sum / NR
    }'
  echo "    distinct jobs: $(tail -n +2 "${PREFIX}-chunks.tsv" | cut -f2 | sort -u | wc -l | tr -d ' ')"
  echo "    instances hit: $(tail -n +2 "${PREFIX}-chunks.tsv" | cut -f5 | sort -u | tr '\n' ' ')"
else
  echo "    (no chunk_ok in the last ${ELAPSED}s — worker may still be draining; raise SETTLE_SECS)"
fi

echo
echo "==> wrote"
echo "    ${PREFIX}-k6.txt"
echo "    ${PREFIX}-chunks.tsv"
echo "    ${PREFIX}-failed.tsv"

exit "$K6_RC"
