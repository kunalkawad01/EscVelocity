# ─────────────────────────────────────────────────────────────────────────────
# MarketDNA — Full Post-Market Workflow (Steps 1-4)
#
# Runs the complete end-of-day pipeline from .claude/CLAUDE.md:
#   Step 1  Ingest fresh data (OHLCV, delivery, options, futures)
#   Step 2  Invalidate backend caches   (via post-market.ps1)
#   Step 3  Snapshot portfolio NAV      (via post-market.ps1)
#   Step 4  Edge Observatory + IV history jobs
#
# This is the script the scheduled task runs. Invalidation alone is pointless
# without Step 1, so the full sequence lives here.
#
# Requires the backend running on -Port (default 8001). Ingestion refreshes the
# DuckDB views; invalidation then makes pages re-read the fresh parquet.
#
# Usage:  .\post-market-full.ps1            # port 8001
#         .\post-market-full.ps1 -Port 8000
# ─────────────────────────────────────────────────────────────────────────────

param(
    [int]$Port = 8001,
    [switch]$SkipIngest    # invalidate + snapshot + jobs only
)

$ErrorActionPreference = "Continue"
$root       = $PSScriptRoot
$dataDir    = Join-Path $root "marketdna-data"
$backendDir = Join-Path $root "marketdna-backend"
$dataPy     = Join-Path $dataDir    ".venv\Scripts\python.exe"
$backendPy  = Join-Path $backendDir ".venv\Scripts\python.exe"

# Log to logs\post-market_YYYY-MM-DD.log
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("post-market_{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))
Start-Transcript -Path $log -Append | Out-Null
Write-Output "===== Post-market run $(Get-Date -Format o) (port $Port) ====="

function Invoke-Py {
    param([string]$Dir, [string]$Py, [string]$Module, [string]$Args = "")
    Write-Output ">> $Module $Args"
    Push-Location $Dir
    try   { & $Py -m $Module $Args.Split(" ", [StringSplitOptions]::RemoveEmptyEntries) }
    catch { Write-Output "ERROR $Module - $($_.Exception.Message)" }
    Pop-Location
}

# ── Step 1 — Ingest ──────────────────────────────────────────────────────────
if (-not $SkipIngest) {
    Write-Output "`n== Step 1: Ingestion =="
    Invoke-Py $dataDir $dataPy "ingestion.download_nse500"
    Invoke-Py $dataDir $dataPy "ingestion.ingest_delivery"
    Invoke-Py $dataDir $dataPy "ingestion.ingest_option_chain"
    Invoke-Py $dataDir $dataPy "ingestion.ingest_futures"
} else {
    Write-Output "`n== Step 1: SKIPPED (-SkipIngest) =="
}

# ── Steps 2 & 3 — Invalidate caches + snapshot NAV ──────────────────────────
Write-Output "`n== Steps 2-3: Invalidate + snapshot =="
& (Join-Path $root "post-market.ps1") -Port $Port

# ── Step 4 — Edge Observatory + IV history ──────────────────────────────────
Write-Output "`n== Step 4: IV history + edge measurements =="
Invoke-Py $backendDir $backendPy "jobs.extract_iv"
Invoke-Py $backendDir $backendPy "jobs.measure_edges" "--if-new-month"

Write-Output "===== Done $(Get-Date -Format o) ====="
Stop-Transcript | Out-Null
