# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the project root with the venv active. On Windows use `.\.venv\Scripts\python.exe`.

```powershell
# Run tests
.\.venv\Scripts\python.exe -m pytest tests\ -v

# Run a single test
.\.venv\Scripts\python.exe -m pytest tests\test_validation.py::test_empty_df -v

# Download Nifty 50 historical data (48 symbols)
.\.venv\Scripts\python.exe -m ingestion.download_all_nse

# Download NSE 500 OHLCV data (incremental, 3 concurrent workers)
.\.venv\Scripts\python.exe -m ingestion.download_nse500

# Force full re-download of all NSE 500 symbols
.\.venv\Scripts\python.exe -m ingestion.download_nse500 --force

# Register DuckDB views and print summary
.\.venv\Scripts\python.exe -m warehouse.register_views

# Download NSE instruments list
.\.venv\Scripts\python.exe -c "from ingestion.kite.instruments import download_instruments; download_instruments()"

# Ingest F&O option chain (current monthly expiry, ATM ± 20 strikes, all FO.csv symbols)
# Output: data_lake/raw/options/date=YYYY-MM-DD/data.parquet + refreshes options_chain DuckDB view
# Fields: ltp, bid, ask, oi, oi_change, volume, iv (%)
.\.venv\Scripts\python.exe -m ingestion.ingest_option_chain

# Ingest F&O futures (current monthly expiry, all FO.csv symbols)
# Output: data_lake/raw/futures/date=YYYY-MM-DD/data.parquet + refreshes futures_chain DuckDB view
# Fields: ltp, bid, ask, oi, oi_change, volume, basis, basis_pct
.\.venv\Scripts\python.exe -m ingestion.ingest_futures

# Feature engine — cold build (all 11 features, full history, ~2 min)
.\.venv\Scripts\python.exe -m feature_engine.compute_all

# Feature engine — incremental update (new rows only, run daily after ingestion)
.\.venv\Scripts\python.exe -m feature_engine.compute_all --incremental

# Feature engine — single feature only
.\.venv\Scripts\python.exe -m feature_engine.compute_all --only sma_regime
```

## Architecture

This is a market data pipeline for Indian equities (Nifty 50) built around three concerns: **ingestion → storage → query**.

```
Kite Connect API
      ↓
ingestion/kite/          # thin wrappers around kiteconnect SDK
      ↓
storage/parquet_writer   # writes hive-partitioned parquet to data_lake/
      ↓
warehouse/register_views # DuckDB views over parquet for analysis
```

### Kite client singleton (`ingestion/kite/client.py`)

`get_kite()` is `@lru_cache(maxsize=1)` — it returns one `KiteConnect` instance for the process lifetime. Every module that needs Kite imports `get_kite` from here. **Do not instantiate `KiteConnect` anywhere else.**

Credentials are loaded at startup via `config/settings.py` (pydantic + python-dotenv). Settings fail fast if any of `KITE_API_KEY`, `KITE_API_SECRET`, `KITE_ACCESS_TOKEN` are missing from `.env`. The access token expires daily and must be refreshed each session.

### Data lake layout (Hive partitioning)

```
data_lake/
  raw/equities/
    symbol=RELIANCE/data.parquet
    symbol=TCS/data.parquet
    ...
  reference/
    instruments.parquet          # full NSE instruments list
```

The `symbol=` directory names are the partition key. DuckDB reads them with `hive_partitioning=true`, which automatically injects `symbol` as a column and prunes partitions on `WHERE symbol = '...'` — only that one file is read.

### DuckDB as the query engine (`warehouse/register_views.py`)

DuckDB is the **primary analysis interface** — do not load parquet into pandas/polars for analysis. Instead:

```python
from warehouse.register_views import get_connection

con = get_connection()
df = con.execute("SELECT * FROM equities_prices WHERE symbol = 'RELIANCE'").pl()
```

`get_connection()` is also `@lru_cache` — safe to call from multiple modules. The view `equities_prices` spans all symbols. DuckDB supports window functions, ASOF joins, and vectorised execution directly on the parquet files.

### NSE 500 bulk download (`ingestion/download_nse500.py`)

Reads symbols from `ind_nifty500list.csv`, matches them to Kite instrument tokens, then downloads OHLCV from 2020-01-01 to today. Key properties:

- **Incremental**: reads each symbol's existing parquet, skips to `max_date + 1`, merges and deduplicates on date. Re-run daily without re-downloading history.
- **Concurrent**: 3 threads each sleeping 1.1 s/call → ~2.7 req/s, under Kite's limit.
- **Chunked**: `date_chunks()` keeps each request ≤1900 calendar days (Kite hard limit is 2000).
- **Compressed**: ZSTD level-3 parquet — ≈3× smaller than uncompressed.
- **Retry**: failed symbols are retried once after all initial downloads finish.
- **DuckDB view** is refreshed automatically on completion.

Symbols missing from Kite instruments (e.g., recently listed stocks) are logged as warnings — they do not fail the run.

### Nifty 50 bulk download (`ingestion/download_all_nse.py`)

Kite's historical data API has a **2000 calendar day hard limit per request**. The script handles this via `date_chunks()` which splits the date range into ≤1900-day windows and concatenates results before writing. Rate limit is 3 req/s; the script sleeps 0.4s between calls. Re-runs are safe — `already_downloaded()` skips symbols whose parquet file exists.

The `NIFTY50_SYMBOLS` set at the top of the file controls which symbols are downloaded. Two symbols (`LTIM`, `TATAMOTORS`) may need their Kite trading symbol verified against `data_lake/reference/instruments.parquet`.

### Validation (`validation/price_validator.py`)

Takes a `polars.DataFrame` (not pandas). Checks: non-empty, required columns present, no nulls, high ≥ low, close > 0, volume ≥ 0. Returns a list of error strings; empty list means valid.
