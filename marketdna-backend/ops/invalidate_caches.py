"""Post-market cache invalidation + portfolio NAV snapshot.

Linux/Docker port of the repo-root `post-market.ps1` (Steps 2-3 of the post-market workflow
documented in .claude/CLAUDE.md). Run AFTER ingestion (Step 1) via `docker compose exec backend
python ops/invalidate_caches.py` so pages pick up today's prices without a backend restart.

Per-endpoint errors are logged, not fatal — mirrors post-market.ps1's try/catch-per-endpoint
behavior so one broken cache doesn't block the rest.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

BASE = "http://localhost:8000"

ENDPOINTS = [
    "/api/stock/invalidate",
    "/api/regime/invalidate",
    "/api/indicators/invalidate",
    "/api/delivery/invalidate",
    "/api/short/invalidate",
    "/api/cointegration/invalidate",
    "/api/markov-options/market/invalidate",
    "/api/stock-health/scan/invalidate",
    "/api/quant/invalidate",
    "/api/options/em-scan/invalidate",
    "/api/options/scan/invalidate",
    "/api/fno/invalidate",
    "/api/portfolios/invalidate",
    "/api/drivers/invalidate",
    "/api/research/invalidate",
    "/api/live-agent/invalidate",
]


def _post(path: str, timeout: int) -> tuple[int, bytes]:
    req = urllib.request.Request(f"{BASE}{path}", method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read()


def main() -> None:
    print(f"== Invalidating caches on {BASE} ==")
    for path in ENDPOINTS:
        try:
            status, _ = _post(path, timeout=60)
            print(f"{status} {BASE}{path}")
        except (urllib.error.URLError, TimeoutError) as exc:
            print(f"ERROR {BASE}{path} - {exc}")

    print("\n== Snapshotting portfolio NAV ==")
    try:
        status, body = _post("/api/portfolios/track/snapshot", timeout=180)
        data = json.loads(body)
        failed = ",".join(data.get("failed", []))
        print(f"snapshotted={data.get('snapshotted')} failed={failed}")
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"ERROR portfolios/track/snapshot - {exc}")

    print("\nDone. Pages re-query DuckDB (fresh parquet) on next request.")


if __name__ == "__main__":
    main()
