#!/bin/bash
# MarketDNA — daily post-market operator routine (VPS, Docker Compose deployment).
#
# Run manually each morning after logging into Kite and copying the fresh access token —
# deliberately NOT a cron job: a blind cron would fail Kite auth every day until a human
# pastes in the new token, so this script takes it as an argument instead.
#
# Usage (from the repo root on the VPS):
#   ./ops/daily-post-market.sh <fresh_kite_access_token>
#
# Steps (mirrors the Windows post-market-full.ps1 + post-market.ps1 workflow):
#   1. Write the fresh token into marketdna-data/.env (physical file — kite_client.py's
#      dotenv_values() and ingestion's load_dotenv() both read it directly, bypassing
#      container env vars entirely).
#   2. Restart the backend container so its @lru_cache'd Kite client re-reads the file.
#   3. Run the 4 ingestion scripts as one-shot containers (continue past per-step failures).
#   4. Invalidate backend caches + snapshot portfolio NAV (inside the backend container — it
#      has no host-exposed port).
#   5. Edge Observatory + IV history jobs.
#
# Errors in any one step are logged but do not abort the rest, matching the PS scripts'
# $ErrorActionPreference = "Continue" behavior.

set -u  # (deliberately not -e — see note above)

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
    echo "Usage: $0 <fresh_kite_access_token>"
    exit 1
fi

mkdir -p logs
LOG_FILE="logs/post-market_$(date +%F).log"

{
    echo "========================================"
    echo "MarketDNA post-market — $(date -Iseconds)"
    echo "========================================"

    echo ""
    echo "[1/5] Writing fresh KITE_ACCESS_TOKEN into marketdna-data/.env ..."
    sed -i "s|^KITE_ACCESS_TOKEN=.*|KITE_ACCESS_TOKEN=${TOKEN}|" marketdna-data/.env
    echo "      Done."

    echo ""
    echo "[2/5] Restarting backend (re-reads the token; kite_client.py is @lru_cache'd) ..."
    docker compose restart backend

    echo ""
    echo "[3/5] Ingestion ..."
    docker compose run --rm ingestion python -m ingestion.download_nse500     || echo "      download_nse500 FAILED"
    docker compose run --rm ingestion python -m ingestion.ingest_delivery     || echo "      ingest_delivery FAILED"
    docker compose run --rm ingestion python -m ingestion.ingest_option_chain || echo "      ingest_option_chain FAILED"
    docker compose run --rm ingestion python -m ingestion.ingest_futures      || echo "      ingest_futures FAILED"

    echo ""
    echo "[4/5] Cache invalidation + NAV snapshot ..."
    docker compose exec -T backend python ops/invalidate_caches.py || echo "      invalidate_caches.py FAILED"

    echo ""
    echo "[5/5] Edge Observatory + IV history ..."
    docker compose exec -T backend python -m jobs.extract_iv                    || echo "      extract_iv FAILED"
    docker compose exec -T backend python -m jobs.measure_edges --if-new-month  || echo "      measure_edges FAILED"

    echo ""
    echo "Done — $(date -Iseconds)"
} 2>&1 | tee "$LOG_FILE"
