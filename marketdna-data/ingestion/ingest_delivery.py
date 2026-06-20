"""
NSE delivery data ingestion from CM bhavcopy (sec_bhavdata_full).

Downloads the full bhavcopy CSV for each missing trading date and writes
deliverable_qty + delivery_pct per NIFTY 50 symbol to the delivery lake.

Output layout (matches existing hive-partitioned structure):
    data_lake/raw/delivery/symbol=XXX/year=YYYY/YYYY-MM-DD.parquet
    Columns: date (Datetime ns), deliverable_qty (Float64), delivery_pct (Float64)

Usage (from marketdna-data/ with venv active):
    .venv\\Scripts\\python.exe -m ingestion.ingest_delivery
    .venv\\Scripts\\python.exe -m ingestion.ingest_delivery --from 2020-01-01
"""

import argparse
import logging
import sys
import time
from datetime import date, datetime, timedelta
from io import StringIO
from pathlib import Path

import polars as pl
import requests

from warehouse.register_views import get_connection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

LAKE_ROOT      = Path("data_lake/raw/delivery")
CALL_SLEEP     = 1.5   # seconds between NSE requests
REQUEST_TIMEOUT = 20

# NSE tries in order — newer archive first, legacy as fallback
_BHAVCOPY_URLS = [
    "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{d}.csv",
    "https://archives.nseindia.com/products/content/sec_bhavdata_full_{d}.csv",
]

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept-Encoding": "gzip, deflate",
    "Accept": "*/*",
    "Referer": "https://www.nseindia.com",
}

_SESSION = requests.Session()
_SESSION.headers.update(_HEADERS)


# ── Helpers ───────────────────────────────────────────────────────────────────

def detect_symbols() -> list[str]:
    """Return tracked symbols from existing delivery lake folders."""
    return sorted(
        p.name.replace("symbol=", "")
        for p in LAKE_ROOT.iterdir()
        if p.is_dir() and p.name.startswith("symbol=")
    )


def last_date_for_symbol(symbol: str) -> date | None:
    """Return the latest parquet date for a symbol (filename stem = YYYY-MM-DD)."""
    sym_dir = LAKE_ROOT / f"symbol={symbol}"
    files = sorted(sym_dir.rglob("*.parquet"))
    return date.fromisoformat(files[-1].stem) if files else None


def trading_dates(start: date, end: date) -> list[date]:
    """All weekdays in [start, end]. Holidays are filtered later by HTTP 404."""
    out, cur = [], start
    while cur <= end:
        if cur.weekday() < 5:
            out.append(cur)
        cur += timedelta(days=1)
    return out


def _safe_float(v: object) -> float | None:
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if s in ("-", "", "NA", "N/A"):
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


# ── Download & parse ──────────────────────────────────────────────────────────

def fetch_bhavcopy(dt: date) -> pl.DataFrame | None:
    """Download and parse full bhavcopy CSV for one date. Returns None on holiday/404."""
    date_str = dt.strftime("%d%m%Y")
    for url_tmpl in _BHAVCOPY_URLS:
        url = url_tmpl.format(d=date_str)
        try:
            resp = _SESSION.get(url, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 200 and resp.text.strip():
                df = pl.read_csv(StringIO(resp.text), infer_schema_length=0)
                df = df.rename({c: c.strip() for c in df.columns})
                return df
        except requests.RequestException as exc:
            log.debug("  %s → %s", url, exc)
    return None


def parse_bhavcopy(df: pl.DataFrame, symbols: set[str]) -> dict[str, tuple[float | None, float | None]]:
    """Extract {symbol: (deliverable_qty, delivery_pct)} for EQ-series rows."""
    cols = {c.upper(): c for c in df.columns}

    sym_col    = cols.get("SYMBOL")
    series_col = next((cols[k] for k in cols if "SERIES" in k), None)
    qty_col    = next((cols[k] for k in cols if "DELIV_QTY" in k or "DELIVERABLE" in k), None)
    pct_col    = next((cols[k] for k in cols if "DELIV_PER" in k or "% DLY" in k or "DELIVERY_PCT" in k), None)

    if not all([sym_col, series_col, qty_col, pct_col]):
        log.warning("  Unexpected bhavcopy columns: %s", df.columns)
        return {}

    df = df.filter(pl.col(series_col).str.strip_chars() == "EQ")

    result: dict[str, tuple[float | None, float | None]] = {}
    for row in df.select([sym_col, qty_col, pct_col]).to_dicts():
        sym = str(row[sym_col]).strip()
        if sym in symbols:
            result[sym] = (_safe_float(row[qty_col]), _safe_float(row[pct_col]))
    return result


# ── Write ─────────────────────────────────────────────────────────────────────

def write_delivery_parquet(symbol: str, dt: date, qty: float | None, pct: float | None) -> None:
    out_dir = LAKE_ROOT / f"symbol={symbol}" / f"year={dt.year}"
    out_dir.mkdir(parents=True, exist_ok=True)
    pl.DataFrame(
        {
            "date": [datetime(dt.year, dt.month, dt.day)],
            "deliverable_qty": [qty],
            "delivery_pct": [pct],
        },
        schema={
            "date": pl.Datetime("ns"),
            "deliverable_qty": pl.Float64,
            "delivery_pct": pl.Float64,
        },
    ).write_parquet(out_dir / f"{dt.isoformat()}.parquet", compression="zstd", compression_level=3)


# ── DuckDB refresh ────────────────────────────────────────────────────────────

def refresh_duckdb() -> None:
    log.info("Refreshing DuckDB delivery_data view…")
    try:
        con = get_connection()
        row = con.execute("""
            SELECT COUNT(DISTINCT symbol),
                   COUNT(*),
                   MIN(STRFTIME('%Y-%m-%d', CAST(date AS DATE))),
                   MAX(STRFTIME('%Y-%m-%d', CAST(date AS DATE)))
            FROM delivery_data
        """).fetchone()
        log.info("delivery_data: %d symbols, %d rows, %s to %s", *row)
    except Exception as exc:
        log.warning("DuckDB refresh failed (non-fatal): %s", exc)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest NSE delivery data from bhavcopy")
    parser.add_argument("--from", dest="from_date", default=None,
                        help="Start date YYYY-MM-DD (default: day after last stored date)")
    args = parser.parse_args()

    symbols = detect_symbols()
    if not symbols:
        log.error("No symbol folders found in %s — run OHLCV ingestion first.", LAKE_ROOT)
        sys.exit(1)

    log.info("Tracking %d symbols", len(symbols))
    symbol_set = set(symbols)

    if args.from_date:
        start = date.fromisoformat(args.from_date)
    else:
        last_dates = [d for d in (last_date_for_symbol(s) for s in symbols) if d is not None]
        start = (max(last_dates) + timedelta(days=1)) if last_dates else date(2020, 1, 1)

    end = date.today() - timedelta(days=1)  # yesterday; today's bhavcopy not yet published

    if start > end:
        log.info("All delivery data is up to date (last: %s).", end)
        return

    dates = trading_dates(start, end)
    log.info("Fetching %d trading dates: %s to %s", len(dates), start, end)

    written = skipped = 0
    for i, dt in enumerate(dates, 1):
        log.info("[%3d/%d] %s", i, len(dates), dt)
        df = fetch_bhavcopy(dt)
        if df is None:
            log.info("  %s: NSE holiday or not yet published — skipped", dt)
            skipped += 1
            time.sleep(CALL_SLEEP)
            continue

        delivery = parse_bhavcopy(df, symbol_set)
        if not delivery:
            log.warning("  %s: no matching symbols in bhavcopy", dt)
            time.sleep(CALL_SLEEP)
            continue

        for sym, (qty, pct) in delivery.items():
            write_delivery_parquet(sym, dt, qty, pct)
        written += len(delivery)
        log.info("  wrote %d symbols", len(delivery))
        time.sleep(CALL_SLEEP)

    log.info("Done — %d symbol-days written, %d dates skipped (holidays/future)", written, skipped)
    refresh_duckdb()


if __name__ == "__main__":
    main()
