"""
F&O Futures ingestion from Kite Connect.

For each symbol in FO.csv:
  - Finds current monthly expiry futures contract
  - Fetches underlying spot price
  - Quotes the futures instrument
  - Computes basis (futures premium/discount vs spot)
  - Writes data_lake/raw/futures/date=YYYY-MM-DD/data.parquet

Fields per row:
  date, symbol, expiry, tradingsymbol, lot_size,
  underlying_price, ltp, bid, ask, oi, oi_change, volume,
  basis, basis_pct

Usage (from marketdna-data/ with venv active):
    .venv\\Scripts\\python.exe -m ingestion.ingest_futures
"""

import argparse
import logging
import sys
import time
from datetime import date
from pathlib import Path

import polars as pl

from ingestion.kite.client import get_kite
from warehouse.register_views import get_connection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

FO_CSV     = Path("FO.csv")
LAKE_ROOT  = Path("data_lake/raw/futures")
CALL_SLEEP = 0.35   # seconds between Kite API calls


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_fo_symbols() -> list[str]:
    return pl.read_csv(FO_CSV)["Ticker"].to_list()


def _nearest_monthly_expiry(expiries: list[date]) -> date | None:
    today = date.today()
    future = sorted(e for e in expiries if e >= today)
    return future[0] if future else None


def _load_prev_oi_map(ref_date: date) -> dict[tuple[str, str], int]:
    """Load the prior trading day's OI (relative to ref_date) once into a lookup dict."""
    yesterday = date.fromordinal(ref_date.toordinal() - 1)
    prev_path = LAKE_ROOT / f"date={yesterday}" / "data.parquet"
    if not prev_path.exists():
        return {}
    try:
        df = pl.read_parquet(prev_path, columns=["symbol", "expiry", "oi"])
        return {(row["symbol"], row["expiry"]): row["oi"] for row in df.iter_rows(named=True)}
    except Exception:
        return {}


# ── Main ingestion logic ──────────────────────────────────────────────────────

def ingest_futures(label_date: date | None = None) -> None:
    """Fetch live futures quotes and write them under `label_date`'s partition.

    `label_date` defaults to today. Pass an earlier date to backfill a day that was
    missed — Kite's quote API only returns live data, so this stamps the current
    live snapshot as a stand-in for the requested (unrecoverable) historical day.
    """
    today     = date.today()
    write_date = label_date or today
    today_str = write_date.isoformat()
    fo_symbols = _load_fo_symbols()
    log.info("Loaded %d F&O symbols from FO.csv", len(fo_symbols))

    kite = get_kite()

    # Step 1 — NFO instruments list (one call)
    log.info("Fetching NFO instruments list ...")
    instruments = kite.instruments("NFO")
    time.sleep(CALL_SLEEP)

    # Filter to FUT only, index by name
    fut_by_name: dict[str, list[dict]] = {}
    for inst in instruments:
        if inst["instrument_type"] == "FUT":
            fut_by_name.setdefault(inst["name"], []).append(inst)

    log.info("  -> %d FUT instruments found across %d underlyings",
             sum(len(v) for v in fut_by_name.values()), len(fut_by_name))

    # Step 2 — Spot prices for all symbols in one batch call
    log.info("Fetching spot prices for %d symbols ...", len(fo_symbols))
    nse_keys    = [f"NSE:{sym}" for sym in fo_symbols]
    spot_quotes = kite.quote(nse_keys)
    time.sleep(CALL_SLEEP)
    spot_price: dict[str, float] = {
        sym: spot_quotes[f"NSE:{sym}"]["last_price"]
        for sym in fo_symbols
        if f"NSE:{sym}" in spot_quotes
    }
    log.info("  -> spot prices for %d / %d symbols", len(spot_price), len(fo_symbols))

    # Step 3 — Select current monthly futures token per symbol
    token_to_meta: dict[int, dict] = {}
    missing: list[str] = []

    for sym in fo_symbols:
        if sym not in fut_by_name:
            log.warning("  %s: no FUT instruments found — skipping", sym)
            missing.append(sym)
            continue

        insts   = fut_by_name[sym]
        expiries = [i["expiry"] for i in insts if isinstance(i["expiry"], date)]
        expiry  = _nearest_monthly_expiry(expiries)
        if expiry is None:
            log.warning("  %s: no current expiry — skipping", sym)
            missing.append(sym)
            continue

        inst = next(i for i in insts if i["expiry"] == expiry)
        token_to_meta[inst["instrument_token"]] = {
            "symbol":        sym,
            "expiry":        expiry.isoformat(),
            "tradingsymbol": inst["tradingsymbol"],
            "lot_size":      int(inst["lot_size"]),
        }

    log.info("Selected %d futures contracts", len(token_to_meta))

    # Step 4 — Quote all futures tokens in one call (211 tokens << 500 limit)
    log.info("Quoting %d futures instruments ...", len(token_to_meta))
    all_tokens  = list(token_to_meta.keys())
    raw_quotes  = kite.quote(all_tokens)
    time.sleep(CALL_SLEEP)
    log.info("  -> received %d quotes", len(raw_quotes))

    # Step 5 — Build rows
    rows: list[dict] = []
    prev_oi_map = _load_prev_oi_map(write_date)

    for token, q in raw_quotes.items():
        meta   = token_to_meta.get(int(token))
        if meta is None:
            continue

        sym    = meta["symbol"]
        expiry = meta["expiry"]
        spot   = spot_price.get(sym, 0.0)

        ltp    = q.get("last_price", 0.0) or 0.0
        volume = q.get("volume", 0) or 0
        oi     = q.get("oi", 0) or 0

        depth  = q.get("depth", {})
        bid    = depth.get("buy",  [{}])[0].get("price", 0.0) or 0.0
        ask    = depth.get("sell", [{}])[0].get("price", 0.0) or 0.0

        prev_oi_val = prev_oi_map.get((sym, expiry))
        oi_change   = (oi - prev_oi_val) if prev_oi_val is not None else None

        basis     = round(ltp - spot, 4) if ltp > 0 and spot > 0 else None
        basis_pct = round((ltp / spot - 1) * 100, 4) if ltp > 0 and spot > 0 else None

        rows.append({
            "date":             today_str,
            "symbol":           sym,
            "expiry":           expiry,
            "tradingsymbol":    meta["tradingsymbol"],
            "lot_size":         meta["lot_size"],
            "underlying_price": spot,
            "ltp":              ltp,
            "bid":              bid,
            "ask":              ask,
            "oi":               oi,
            "oi_change":        oi_change,
            "volume":           volume,
            "basis":            basis,
            "basis_pct":        basis_pct,
        })

    if not rows:
        log.error("No rows produced — nothing to write.")
        return

    # Step 6 — Write parquet
    df = pl.DataFrame(rows, schema={
        "date":             pl.Utf8,
        "symbol":           pl.Utf8,
        "expiry":           pl.Utf8,
        "tradingsymbol":    pl.Utf8,
        "lot_size":         pl.Int64,
        "underlying_price": pl.Float64,
        "ltp":              pl.Float64,
        "bid":              pl.Float64,
        "ask":              pl.Float64,
        "oi":               pl.Int64,
        "oi_change":        pl.Int64,
        "volume":           pl.Int64,
        "basis":            pl.Float64,
        "basis_pct":        pl.Float64,
    })

    out_dir = LAKE_ROOT / f"date={today_str}"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "data.parquet"
    df.write_parquet(out_path, compression="zstd", compression_level=3)

    log.info("Written %d rows -> %s  (%.1f KB)",
             len(df), out_path, out_path.stat().st_size / 1024)
    log.info("Symbols with data: %d / %d", df["symbol"].n_unique(), len(fo_symbols))
    if missing:
        log.warning("Symbols skipped: %s", ", ".join(missing))

    # Step 7 — Refresh DuckDB futures_chain view
    try:
        con = get_connection()
        con.execute(f"""
            CREATE OR REPLACE VIEW futures_chain AS
            SELECT * FROM read_parquet('{LAKE_ROOT.as_posix()}/date=*/data.parquet',
                                       hive_partitioning = true)
        """)
        row_count = con.execute(
            "SELECT COUNT(*) FROM futures_chain WHERE date = ?", [today_str]
        ).fetchone()[0]
        log.info("DuckDB futures_chain view refreshed -- %d rows for %s",
                 row_count, today_str)
    except Exception as exc:
        log.warning("DuckDB view refresh failed (non-fatal): %s", exc)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--date", type=str, default=None,
        help="Label this live quote pull as YYYY-MM-DD instead of today "
             "(backfill for a day whose live snapshot was never captured).",
    )
    args = parser.parse_args()
    label = date.fromisoformat(args.date) if args.date else None
    ingest_futures(label_date=label)
