"""
NSE 500 OHLCV bulk ingestion from Kite Connect.

Design
------
- Reads 500 symbols from ind_nifty500list.csv (Symbol column).
- Incremental: if a parquet file already exists for a symbol, only fetches
  dates after its max stored date — safe to re-run daily.
- Concurrent: 3 threads each sleeping 1.1 s after every API call → ~2.7 req/s,
  well under Kite's 3 req/s limit.
- Chunks: Kite caps each request at 2000 calendar days; MAX_DAYS=1900 gives
  headroom. 2020-01-01→today needs 2 chunks per symbol.
- ZSTD compression on all parquet writes (≈3× smaller than uncompressed).
- Retry: failed symbols are retried once after all initial passes complete.
- DuckDB view is refreshed automatically on completion.

Usage (from marketdna-data/ with venv active)
---------------------------------------------
    .venv\\Scripts\\python.exe -m ingestion.download_nse500

    # Force full re-download, ignoring all existing data:
    .venv\\Scripts\\python.exe -m ingestion.download_nse500 --force
"""

import argparse
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path

import polars as pl

from ingestion.kite.history import download_history
from ingestion.kite.instruments import download_instruments
from validation.price_validator import validate_prices
from warehouse.register_views import get_connection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
START_DATE = date(2020, 1, 1)
END_DATE = date.today()
MAX_DAYS = 1900          # stay under Kite's 2000-day hard limit per request
MAX_WORKERS = 3          # concurrent download threads
CALL_SLEEP = 1.1         # seconds to sleep after each Kite API call per worker
RETRY_SLEEP = 10.0       # pause before the retry pass

NSE500_CSV = Path("ind_nifty500list.csv")
LAKE_ROOT = Path("data_lake/raw/equities")

# Explicit schema enforced on every Kite response — prevents Int64/Float64
# mismatch that occurs when a small incremental batch has all-integer prices.
OHLCV_SCHEMA = {
    "date": pl.Datetime("us", "UTC"),
    "open": pl.Float64,
    "high": pl.Float64,
    "low": pl.Float64,
    "close": pl.Float64,
    "volume": pl.Int64,
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def read_nse500_symbols() -> set[str]:
    """Return the set of trading symbols from ind_nifty500list.csv."""
    df = pl.read_csv(NSE500_CSV)
    return set(df["Symbol"].to_list())


def date_chunks(start: date, end: date) -> list[tuple[date, date]]:
    """Split [start, end] into ≤MAX_DAYS-wide windows (inclusive on both ends)."""
    chunks: list[tuple[date, date]] = []
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=MAX_DAYS - 1), end)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)
    return chunks


def parquet_path(symbol: str) -> Path:
    return LAKE_ROOT / f"symbol={symbol}" / "data.parquet"


def get_last_stored_date(symbol: str) -> date | None:
    """Return the latest date in the existing parquet file, or None."""
    p = parquet_path(symbol)
    if not p.exists():
        return None
    df = pl.read_parquet(p, columns=["date"])
    if df.is_empty():
        return None
    raw = df["date"].max()
    # Kite returns timezone-aware datetimes; extract date portion safely
    if hasattr(raw, "date"):
        return raw.date()
    return raw


def write_parquet_zstd(symbol: str, df: pl.DataFrame) -> Path:
    """Write a validated DataFrame to the data lake with ZSTD compression."""
    p = parquet_path(symbol)
    p.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(p, compression="zstd", compression_level=3)
    return p


def cast_to_schema(df: pl.DataFrame) -> pl.DataFrame:
    """Cast any column that diverges from OHLCV_SCHEMA to the target dtype.

    Handles both directions: Int64->Float64 (small batch all-integer prices)
    and Float64->Int64 (existing files written before schema enforcement).
    """
    exprs = [
        pl.col(col).cast(dtype)
        for col, dtype in OHLCV_SCHEMA.items()
        if col in df.columns and df[col].dtype != dtype
    ]
    return df.with_columns(exprs) if exprs else df


def merge_into_lake(symbol: str, new_records: list[dict], force: bool) -> tuple[int, int]:
    """Merge new_records with any existing parquet, dedup on date, write back.

    Returns (rows_before, rows_after).
    """
    # Enforce schema explicitly: small incremental batches can have all-integer
    # prices, causing Polars to infer Int64 instead of Float64, which breaks
    # concat with existing Float64 parquet data.
    new_df = pl.DataFrame(new_records, schema=OHLCV_SCHEMA).sort("date")

    p = parquet_path(symbol)
    if p.exists() and not force:
        existing = cast_to_schema(pl.read_parquet(p))  # normalise legacy dtype mismatches
        rows_before = len(existing)
        combined = pl.concat([existing, new_df])
    else:
        existing = None
        rows_before = 0
        combined = new_df

    combined = (
        combined
        .sort("date")
        .unique(subset=["date"], keep="last")
        .sort("date")
    )

    errors = validate_prices(combined)
    if errors:
        log.warning(f"{symbol}: validation issues — {errors}")

    write_parquet_zstd(symbol, combined)
    return rows_before, len(combined)


# ── Worker ────────────────────────────────────────────────────────────────────

def process_symbol(
    symbol: str,
    token: int,
    force: bool,
) -> tuple[str, str]:
    """Download (or incrementally update) OHLCV for one symbol.

    Returns (symbol, status_string).
    """
    try:
        if force:
            start = START_DATE
        else:
            last = get_last_stored_date(symbol)
            if last is None:
                start = START_DATE
            elif last < END_DATE:
                start = last + timedelta(days=1)
            elif last == END_DATE:
                # Today's stored candle may be a partial intraday snapshot from an
                # earlier same-day run — always re-fetch today so the final EOD
                # close overwrites it (merge_into_lake dedups by date, keep="last").
                start = END_DATE
            else:
                return symbol, "up-to-date"

        if start > END_DATE:
            return symbol, "up-to-date"

        chunks = date_chunks(start, END_DATE)
        all_records: list[dict] = []

        for i, (chunk_start, chunk_end) in enumerate(chunks):
            records = download_history(token, str(chunk_start), str(chunk_end))
            all_records.extend(records)
            time.sleep(CALL_SLEEP)
            log.debug(
                f"{symbol}: chunk {i + 1}/{len(chunks)} "
                f"({chunk_start} to {chunk_end}) => {len(records)} rows"
            )

        if not all_records:
            return symbol, "empty — no records returned"

        rows_before, rows_after = merge_into_lake(symbol, all_records, force)
        added = rows_after - rows_before
        return symbol, f"ok — +{added} rows (total {rows_after})"

    except Exception as exc:  # noqa: BLE001
        log.error(f"{symbol}: {exc}")
        return symbol, f"error: {exc}"


# ── Orchestration ─────────────────────────────────────────────────────────────

def run_pass(
    work: list[tuple[str, int]],
    force: bool,
    label: str,
) -> tuple[list[str], list[str]]:
    """Run one ingestion pass over the work list.

    Returns (failed_symbols, ok_symbols).
    """
    failed: list[str] = []
    ok: list[str] = []
    total = len(work)

    log.info(f"[{label}] Starting {total} symbols with {MAX_WORKERS} workers")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="nse500") as pool:
        futures = {
            pool.submit(process_symbol, sym, tok, force): sym
            for sym, tok in work
        }
        done = 0
        for future in as_completed(futures):
            done += 1
            symbol, status = future.result()
            tag = "SKIP" if "up-to-date" in status else ("ERR" if status.startswith("error") else "OK ")
            log.info(f"[{done:>3}/{total}] [{tag}] {symbol}: {status}")
            if status.startswith("error"):
                failed.append(symbol)
            else:
                ok.append(symbol)

    return failed, ok


def build_token_map(nse500_symbols: set[str]) -> tuple[dict[str, int], list[str]]:
    """Fetch Kite instruments and map NSE 500 symbols to instrument tokens.

    Returns (symbol→token dict, list of unmatched symbols).
    """
    log.info("Fetching NSE instruments from Kite…")
    instruments = download_instruments()

    equities = instruments.filter(
        (pl.col("exchange") == "NSE")
        & (pl.col("segment") == "NSE")
        & (pl.col("instrument_type") == "EQ")
    )

    kite_symbols = set(equities["tradingsymbol"].to_list())
    matched = nse500_symbols & kite_symbols
    unmatched = sorted(nse500_symbols - kite_symbols)

    if unmatched:
        log.warning(f"Symbols not found in Kite instruments ({len(unmatched)}): {unmatched}")

    token_map: dict[str, int] = {}
    for row in equities.filter(pl.col("tradingsymbol").is_in(matched)).to_dicts():
        token_map[row["tradingsymbol"]] = int(row["instrument_token"])

    log.info(f"Matched {len(token_map)}/{len(nse500_symbols)} symbols")
    return token_map, unmatched


def refresh_duckdb() -> None:
    """Re-register DuckDB views so newly written partitions are visible."""
    log.info("Refreshing DuckDB views…")
    try:
        con = get_connection()
        summary = con.execute("""
            SELECT COUNT(DISTINCT symbol) AS symbols,
                   COUNT(*)              AS total_rows,
                   MIN(STRFTIME('%Y-%m-%d', CAST(date AS DATE))) AS from_date,
                   MAX(STRFTIME('%Y-%m-%d', CAST(date AS DATE))) AS to_date
            FROM equities_prices
        """).fetchone()
        log.info(
            f"DuckDB: {summary[0]} symbols, {summary[1]:,} rows, "
            f"{summary[2]} to {summary[3]}"
        )
    except Exception as exc:  # noqa: BLE001
        log.warning(f"DuckDB refresh failed (non-fatal): {exc}")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest NSE 500 OHLCV data from Kite Connect")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download all data from START_DATE, ignoring existing files",
    )
    args = parser.parse_args()

    log.info(f"NSE 500 ingestion | range {START_DATE} to {END_DATE} | force={args.force}")

    nse500_symbols = read_nse500_symbols()
    log.info(f"Loaded {len(nse500_symbols)} symbols from {NSE500_CSV}")

    token_map, unmatched = build_token_map(nse500_symbols)
    work = sorted(token_map.items())  # deterministic order

    # ── Pass 1 ────────────────────────────────────────────────────────────────
    t0 = time.monotonic()
    failed, _ = run_pass(work, force=args.force, label="Pass 1")

    # ── Pass 2 (retry) ────────────────────────────────────────────────────────
    if failed:
        log.info(f"Retrying {len(failed)} failed symbols in {RETRY_SLEEP:.0f}s…")
        time.sleep(RETRY_SLEEP)
        retry_work = [(s, token_map[s]) for s in failed]
        still_failed, _ = run_pass(retry_work, force=args.force, label="Retry")
    else:
        still_failed = []

    elapsed = time.monotonic() - t0

    # ── Summary ───────────────────────────────────────────────────────────────
    log.info("=" * 60)
    log.info(f"Elapsed : {elapsed:.1f}s ({elapsed / 60:.1f} min)")
    log.info(f"Matched : {len(token_map)}/{len(nse500_symbols)}")
    log.info(f"Unmatched (not in Kite): {len(unmatched)}")
    log.info(f"Still failed after retry: {len(still_failed)}")
    if still_failed:
        log.warning(f"Failed symbols: {', '.join(still_failed)}")
    log.info("=" * 60)

    refresh_duckdb()


if __name__ == "__main__":
    main()
