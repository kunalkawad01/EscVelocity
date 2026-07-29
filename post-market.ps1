# ─────────────────────────────────────────────────────────────────────────────
# MarketDNA — Post-Market Cache Invalidation + Snapshot
#
# Runs Step 2 (cache invalidation) and Step 3 (portfolio NAV snapshot) of the
# post-market workflow documented in .claude/CLAUDE.md. Run AFTER ingestion
# (Step 1) so pages pick up today's prices without a backend restart.
#
# Usage:
#   .\post-market.ps1                # backend on default port 8001
#   .\post-market.ps1 -Port 8000     # override port
#
# The two Research Copilot / Live Agent endpoints are included below so their
# in-process caches (screen/EDA/backtest results, market_state, board) refresh
# with the rest of the platform.
# ─────────────────────────────────────────────────────────────────────────────

param(
    [int]$Port = 8001
)

$base = "http://localhost:$Port"

$endpoints = @(
    "$base/api/stock/invalidate",
    "$base/api/regime/invalidate",
    "$base/api/indicators/invalidate",
    "$base/api/delivery/invalidate",
    "$base/api/short/invalidate",
    "$base/api/cointegration/invalidate",
    "$base/api/markov-options/market/invalidate",
    "$base/api/stock-health/scan/invalidate",
    "$base/api/quant/invalidate",
    "$base/api/options/em-scan/invalidate",
    "$base/api/options/scan/invalidate",
    "$base/api/fno/invalidate",
    "$base/api/portfolios/invalidate",
    "$base/api/drivers/invalidate",
    "$base/api/research/invalidate",      # Research Copilot (Phases 1-4)
    "$base/api/live-agent/invalidate"     # Live Market Agent (Phase 5)
)

Write-Output "== Invalidating caches on $base =="
foreach ($url in $endpoints) {
    try {
        $r = Invoke-WebRequest -Uri $url -Method POST -UseBasicParsing -TimeoutSec 60 -ErrorAction Stop
        Write-Output "$($r.StatusCode) $url"
    } catch {
        Write-Output "ERROR $url - $($_.Exception.Message)"
    }
}

# Step 3 — persist EOD portfolio NAV points (idempotent, keyed by trading date)
Write-Output ""
Write-Output "== Snapshotting portfolio NAV =="
try {
    $r = Invoke-RestMethod -Uri "$base/api/portfolios/track/snapshot" -Method POST -TimeoutSec 180
    Write-Output "snapshotted=$($r.snapshotted) failed=$($r.failed -join ',')"
} catch {
    Write-Output "ERROR portfolios/track/snapshot - $($_.Exception.Message)"
}

Write-Output ""
Write-Output "Done. Pages re-query DuckDB (fresh parquet) on next request."
