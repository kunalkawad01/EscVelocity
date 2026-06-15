"""NSE Delivery Data Downloader.

Downloads daily bhavcopy files from NSE archives and extracts delivery
percentage data for NIFTY 50 equities.  Stores results as hive-partitioned
parquet in data_lake/raw/delivery/.

Usage
─────
    python ingestion/nse_delivery_downloader.py                         # 2020-01-01 → today
    python ingestion/nse_delivery_downloader.py --start 2024-01-01      # specific start
    python ingestion/nse_delivery_downloader.py --start 2024-01-01 --end 2024-12-31

The script is resumable: dates already present in the parquet lake are
skipped automatically.  Run it again after any gap to fill in missing data.

Source
──────
NSE full security bhavcopy:
    https://archives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv

Columns used:
    Symbol, Series, DeliverableQty, PercentDelvToTradedQty

Only EQ (Normal Equity) series rows are kept.
"""
import argparse
import io
import logging
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import requests

# ─── Setup ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("nse_delivery")

# Adjust path so we can import from parent package even when run directly
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

try:
    from app.config import settings
    DATA_ROOT = settings.data_path
except Exception:
    DATA_ROOT = ROOT.parent / "marketdna-data"

DELIVERY_ROOT = DATA_ROOT / "data_lake" / "raw" / "delivery"

NIFTY50 = {
    "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK",
    "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV", "BPCL", "BHARTIARTL",
    "BRITANNIA", "CIPLA", "COALINDIA", "DIVISLAB", "DRREDDY",
    "EICHERMOT", "GRASIM", "HCLTECH", "HDFCBANK", "HDFCLIFE",
    "HEROMOTOCO", "HINDALCO", "HINDUNILVR", "ICICIBANK", "ITC",
    "INDUSINDBK", "INFY", "JSWSTEEL", "KOTAKBANK", "LT",
    "M&M", "MARUTI", "NESTLEIND", "NTPC", "ONGC",
    "POWERGRID", "RELIANCE", "SBILIFE", "SBIN", "SUNPHARMA",
    "TATACONSUM", "TATAMOTORS", "TATASTEEL", "TCS", "TECHM",
    "TITAN", "TRENT", "ULTRACEMCO", "WIPRO", "SHRIRAMFIN",
}

_BASE_URL = "https://archives.nseindia.com/products/content/sec_bhavdata_full_{date}.csv"
_SLEEP    = 1.2    # seconds between requests — be polite to NSE
_RETRIES  = 3


# ─── Session ──────────────────────────────────────────────────────────────────

def _make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer":         "https://www.nseindia.com/",
    })
    # Warm the session so NSE sets cookies
    try:
        s.get("https://www.nseindia.com", timeout=15)
        time.sleep(1)
    except Exception as exc:
        log.warning("session warm-up failed: %s", exc)
    return s


# ─── Existing dates ───────────────────────────────────────────────────────────

def _already_downloaded() -> set[date]:
    """Return dates already present in the delivery parquet lake."""
    existing: set[date] = set()
    if not DELIVERY_ROOT.exists():
        return existing
    for sym_dir in DELIVERY_ROOT.iterdir():
        if not sym_dir.is_dir():
            continue
        for year_dir in sym_dir.iterdir():
            if not year_dir.is_dir():
                continue
            for pq_file in year_dir.glob("*.parquet"):
                try:
                    tbl = pq.read_table(pq_file, columns=["date"])
                    for d in tbl["date"].to_pylist():
                        existing.add(d.date() if hasattr(d, "date") else d)
                except Exception:
                    pass
    return existing


# ─── Download one day ─────────────────────────────────────────────────────────

def _fetch_day(session: requests.Session, d: date) -> pd.DataFrame | None:
    """Download and parse NSE bhav copy for one date. Returns None if not a trading day."""
    url = _BASE_URL.format(date=d.strftime("%d%m%Y"))
    for attempt in range(_RETRIES):
        try:
            r = session.get(url, timeout=20)
            if r.status_code == 404:
                return None          # holiday / weekend
            r.raise_for_status()
            break
        except requests.HTTPError:
            return None
        except Exception as exc:
            if attempt == _RETRIES - 1:
                log.warning("  failed after %d retries: %s", _RETRIES, exc)
                return None
            time.sleep(2 ** attempt)

    try:
        df = pd.read_csv(io.StringIO(r.text))
        # Normalise column names (NSE sometimes has leading spaces)
        df.columns = [c.strip() for c in df.columns]

        # Keep only EQ series — handle both capitalisation variants
        series_col = next((c for c in df.columns if c.upper() == "SERIES"), None)
        if series_col:
            df = df[df[series_col].str.strip() == "EQ"]

        # Normalise all columns to uppercase for consistent matching
        df.columns = [c.strip().upper() for c in df.columns]

        # Rename to canonical column names
        # NSE uses: SYMBOL, DELIV_QTY, DELIV_PER  (old format: Symbol, DeliverableQty, PercentDelvToTradedQty)
        rename = {
            "SYMBOL":                    "symbol",
            "DELIV_QTY":                 "deliverable_qty",
            "DELIV_PER":                 "delivery_pct",
            # Legacy column names (pre-2021 bhav format)
            "DELIVERABLEQTY":            "deliverable_qty",
            "PERCENTDELVTOTRADEDQTY":    "delivery_pct",
        }
        df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})

        required = {"symbol", "deliverable_qty", "delivery_pct"}
        if not required.issubset(df.columns):
            log.warning("  %s: missing columns %s — found: %s", d, required - set(df.columns), list(df.columns))
            return None

        df["symbol"] = df["symbol"].str.strip()
        df = df[df["symbol"].isin(NIFTY50)][["symbol", "deliverable_qty", "delivery_pct"]]
        df["deliverable_qty"] = pd.to_numeric(df["deliverable_qty"], errors="coerce")
        df["delivery_pct"]    = pd.to_numeric(df["delivery_pct"],    errors="coerce")
        df["date"] = pd.Timestamp(d)
        df = df.dropna(subset=["delivery_pct"])
        return df if not df.empty else None

    except Exception as exc:
        log.warning("  parse error for %s: %s", d, exc)
        return None


# ─── Write parquet ────────────────────────────────────────────────────────────

def _write_day(df: pd.DataFrame, d: date) -> None:
    """Append one day's delivery data into hive-partitioned parquet lake."""
    schema = pa.schema([
        pa.field("date",            pa.timestamp("ns")),
        pa.field("deliverable_qty", pa.float64()),
        pa.field("delivery_pct",    pa.float64()),
    ])

    for symbol, group in df.groupby("symbol"):
        out_dir = DELIVERY_ROOT / f"symbol={symbol}" / f"year={d.year}"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{d.isoformat()}.parquet"
        tbl = pa.Table.from_pandas(
            group[["date", "deliverable_qty", "delivery_pct"]].reset_index(drop=True),
            schema=schema,
        )
        pq.write_table(tbl, out_path, compression="snappy")


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(start: date, end: date) -> None:
    log.info("NSE Delivery Downloader")
    log.info("  range:  %s → %s", start, end)
    log.info("  output: %s", DELIVERY_ROOT)

    already = _already_downloaded()
    log.info("  already downloaded: %d dates", len(already))

    session = _make_session()
    session_age = 0   # refresh session every 200 requests

    d = start
    downloaded = skipped = holidays = 0
    while d <= end:
        if d in already:
            d += timedelta(days=1)
            skipped += 1
            continue

        if d.weekday() >= 5:    # skip weekends fast
            d += timedelta(days=1)
            continue

        if session_age > 200:
            log.info("refreshing NSE session...")
            session = _make_session()
            session_age = 0

        df = _fetch_day(session, d)
        session_age += 1

        if df is None:
            holidays += 1
            log.debug("  %s — holiday/weekend", d)
        else:
            _write_day(df, d)
            downloaded += 1
            log.info("  %s — %d rows saved", d, len(df))

        time.sleep(_SLEEP)
        d += timedelta(days=1)

    log.info("Done. downloaded=%d  skipped=%d  non-trading=%d", downloaded, skipped, holidays)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download NSE delivery % data")
    parser.add_argument("--start", default="2020-01-01", help="Start date YYYY-MM-DD")
    parser.add_argument("--end",   default=date.today().isoformat(), help="End date YYYY-MM-DD")
    args = parser.parse_args()

    run(
        start=date.fromisoformat(args.start),
        end=date.fromisoformat(args.end),
    )
