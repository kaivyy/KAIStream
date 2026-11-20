#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${ROOT_DIR}/logs"
LOG_FILE="${LOG_DIR}/auto_sync.log"
LOCK_FILE="/tmp/kaistream_auto_sync.lock"

mkdir -p "${LOG_DIR}"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Another KAIStream sync is already running; skipping." >> "${LOG_FILE}"
  exit 0
fi

START_TS="$(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "=== KAIStream Auto-Sync started at ${START_TS} ===" >> "${LOG_FILE}"

if python3 "${ROOT_DIR}/scripts/build_java_data.py" \
  --auto \
  --output-dir "${ROOT_DIR}/public/data" \
  --mirror-dir "${ROOT_DIR}/dist/data" 2>&1 | tee -a "${LOG_FILE}"; then
  END_TS="$(date '+%Y-%m-%d %H:%M:%S %Z')"
  SUMMARY="$(python3 -c "import json; m=json.load(open('${ROOT_DIR}/public/data/metadata.json')); print(f\"snapshot={m.get('scheduleSnapshotDate')} trips={m['counts']['trips']} stations={m['counts']['stations']} passPts={m['counts'].get('passTimingPoints',0)}\")")"
  echo "[${END_TS}] SUCCESS: ${SUMMARY}" >> "${LOG_FILE}"
  STATUS=0
else
  END_TS="$(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "[${END_TS}] FAILED: build_java_data.py exited with non-zero status" >> "${LOG_FILE}"
  STATUS=1
fi

# Keep log bounded to last 500 lines
if [ -f "${LOG_FILE}" ] && [ "$(wc -l < "${LOG_FILE}")" -gt 600 ]; then
  tail -n 500 "${LOG_FILE}" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "${LOG_FILE}"
fi

exit "${STATUS}"
