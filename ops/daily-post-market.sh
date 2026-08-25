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
#   4. Feature engine incremental update — rebuilds returns_features and the other 12
#      feature parquets (DataViz, Stock DNA, Market DNA, etc. all read from these; without
#      this step they silently drift stale since nothing else rewrites them).
#   5. Invalidate backend caches + snapshot portfolio NAV (inside the backend container — it
#      has no host-exposed port).
#   6. Edge Observatory + IV history jobs.
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
    echo "[1/6] Writing fresh KITE_ACCESS_TOKEN into marketdna-data/.env ..."
    sed -i "s|^KITE_ACCESS_TOKEN=.*|KITE_ACCESS_TOKEN=${TOKEN}|" marketdna-data/.env
    echo "      Done."

    echo ""
    echo "[2/6] Restarting backend (re-reads the token; kite_client.py is @lru_cache'd) ..."
    docker compose restart backend

    echo ""
    echo "[3/6] Ingestion ..."
    docker compose run --rm ingestion python -m ingestion.download_nse500     || echo "      download_nse500 FAILED"
    docker compose run --rm ingestion python -m ingestion.ingest_delivery     || echo "      ingest_delivery FAILED"
    docker compose run --rm ingestion python -m ingestion.ingest_option_chain || echo "      ingest_option_chain FAILED"
    docker compose run --rm ingestion python -m ingestion.ingest_futures      || echo "      ingest_futures FAILED"

    echo ""
    echo "[4/6] Feature engine incremental update ..."
    docker compose run --rm ingestion python -m feature_engine.compute_all --incremental || echo "      feature_engine.compute_all FAILED"

    echo ""
    echo "[5/6] Cache invalidation + NAV snapshot ..."
    docker compose exec -T backend python ops/invalidate_caches.py || echo "      invalidate_caches.py FAILED"

    echo ""
    echo "[6/6] Edge Observatory + IV history ..."
    docker compose exec -T backend python -m jobs.extract_iv                    || echo "      extract_iv FAILED"
    docker compose exec -T backend python -m jobs.measure_edges --if-new-month  || echo "      measure_edges FAILED"

    echo ""
    echo "Done — $(date -Iseconds)"
} 2>&1 | tee "$LOG_FILE"
