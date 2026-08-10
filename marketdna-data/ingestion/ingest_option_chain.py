"""
F&O Option Chain ingestion from Kite Connect.

For each symbol in FO.csv:
  - Finds current monthly expiry (nearest expiry >= today)
  - Fetches underlying spot price
  - Selects ATM ± 20 strikes (CE + PE)
  - Quotes all instruments in batches of 500
  - Computes IV via Black-Scholes bisection
  - Writes data_lake/raw/options/date=YYYY-MM-DD/data.parquet

Fields per row:
  date, symbol, expiry, strike, option_type,
  underlying_price, ltp, bid, ask, oi, oi_change, volume, iv

Usage (from marketdna-data/ with venv active):
    .venv\\Scripts\\python.exe -m ingestion.ingest_option_chain
"""

import argparse
import logging
import sys
import time
from datetime import date, datetime
from pathlib import Path

import numpy as np
import polars as pl
from scipy.optimize import brentq
from scipy.stats import norm

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

FO_CSV      = Path("FO.csv")
LAKE_ROOT   = Path("data_lake/raw/options")
CALL_SLEEP  = 0.35          # seconds between Kite API calls (3 req/s limit)
BATCH_SIZE  = 500           # max tokens per kite.quote() call
STRIKES_EACH_SIDE = 20      # ATM ± N strikes
RISK_FREE_RATE    = 0.065   # India 10Y approx

# Index options: FO.csv is stock-only, so index underlyings are handled as a
# separate path. Maps the NFO instrument `name` (option underlying) to the
# NSE tradingsymbol used for the index's own spot quote.
INDEX_SYMBOLS: dict[str, str] = {"NIFTY": "NIFTY 50"}
INDEX_EXPIRIES = 8   # weekly expiries to capture for index options (vs 1 for stocks)

# ── IV computation (pure Black-Scholes, no external library needed) ───────────

def _bs_price(S: float, K: float, T: float, r: float, sigma: float, opt: str) -> float:
    """European Black-Scholes option price."""
    sqrt_T = np.sqrt(T)
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrt_T)
    d2 = d1 - sigma * sqrt_T
    if opt == "CE":
        return S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
    return K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)


def compute_iv(ltp: float, S: float, K: float, T: float, opt: str) -> float | None:
    """Return implied volatility (%) or None if not solvable."""
    if ltp <= 0 or T <= 0 or S <= 0:
        return None
    intrinsic = max(0.0, S - K) if opt == "CE" else max(0.0, K - S)
    if ltp < intrinsic or ltp >= S:
        return None
    try:
        iv = brentq(
            lambda sig: _bs_price(S, K, T, RISK_FREE_RATE, sig, opt) - ltp,
            1e-6, 5.0, xtol=1e-5, maxiter=100,
        )
        return round(iv * 100, 2)
    except Exception:
        return None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_fo_symbols() -> list[str]:
    df = pl.read_csv(FO_CSV)
    return df["Ticker"].to_list()


def _nearest_monthly_expiry(expiries: list[date]) -> date | None:
    """Return the earliest expiry on or after today."""
    today = date.today()
    future = sorted(e for e in expiries if e >= today)
    return future[0] if future else None


def _detect_strike_interval(strikes: list[float]) -> float:
    """Infer the strike step from the instruments list (mode of differences)."""
    if len(strikes) < 2:
        return 50.0
    diffs = sorted(abs(strikes[i+1] - strikes[i]) for i in range(len(strikes)-1))
    # Use the smallest non-zero gap as the tick
    for d in diffs:
        if d > 0:
            return d
    return 50.0


def _atm_strike(spot: float, interval: float) -> float:
    """Round spot to nearest strike interval."""
    return round(round(spot / interval) * interval, 4)


def _load_prev_oi_map(ref_date: date) -> dict[tuple[str, float, str, str], int]:
    """Load the prior trading day's OI (relative to ref_date) once into a lookup dict.

    Scans existing date=* partitions for the latest one strictly before ref_date,
    rather than assuming ref_date - 1 calendar day is a trading day. A fixed
    1-day lookback misses the prior session across weekends/holidays (e.g. on a
    Monday, "yesterday" is Sunday — no partition — so oi_change would come back
    NULL even though Friday's data exists). Mirrors the ranked-session join
    fno_tactical_service.py uses for futures_chain.
    """
    if not LAKE_ROOT.exists():
        return {}
    candidates: list[date] = []
    for p in LAKE_ROOT.iterdir():
        if not p.is_dir() or not p.name.startswith("date="):
            continue
        try:
            d = date.fromisoformat(p.name[len("date="):])
        except ValueError:
            continue
        if d < ref_date:
            candidates.append(d)
    if not candidates:
        return {}
    prev_path = LAKE_ROOT / f"date={max(candidates)}" / "data.parquet"
    if not prev_path.exists():
        return {}
    try:
        df = pl.read_parquet(prev_path, columns=["symbol", "strike", "option_type", "expiry", "oi"])
        return {
            (row["symbol"], row["strike"], row["option_type"], row["expiry"]): row["oi"]
            for row in df.iter_rows(named=True)
        }
    except Exception:
        return {}


# ── Main ingestion logic ──────────────────────────────────────────────────────

def ingest_option_chain(label_date: date | None = None) -> None:
    """Fetch live option chain quotes and write them under `label_date`'s partition.

    `label_date` defaults to today. Pass an earlier date to backfill a day that was
    missed — Kite's quote API only returns live data, so this stamps the current
    live snapshot as a stand-in for the requested (unrecoverable) historical day.
    """
    today = date.today()
    write_date = label_date or today
    fo_symbols = _load_fo_symbols()
    log.info("Loaded %d F&O symbols from FO.csv", len(fo_symbols))

    kite = get_kite()

    # Step 1 — Download NFO instruments (one call, all options)
    log.info("Fetching NFO instruments list …")
    instruments = kite.instruments("NFO")
    time.sleep(CALL_SLEEP)
    log.info("  -> %d NFO instruments", len(instruments))

    # Index by underlying name, filter to CE/PE only
    nfo_by_name: dict[str, list[dict]] = {}
    for inst in instruments:
        if inst["instrument_type"] not in ("CE", "PE"):
            continue
        nfo_by_name.setdefault(inst["name"], []).append(inst)

    # Step 2 — Get spot prices for all FO symbols, plus index underlyings, in one batch
    nse_keys = [f"NSE:{sym}" for sym in fo_symbols] + [f"NSE:{v}" for v in INDEX_SYMBOLS.values()]
    log.info("Fetching spot prices for %d symbols …", len(nse_keys))
    spot_quotes = kite.quote(nse_keys)
    time.sleep(CALL_SLEEP)
    spot_price: dict[str, float] = {
        sym: spot_quotes[f"NSE:{sym}"]["last_price"]
        for sym in fo_symbols
        if f"NSE:{sym}" in spot_quotes
    }
    for idx_sym, nse_tradingsymbol in INDEX_SYMBOLS.items():
        key = f"NSE:{nse_tradingsymbol}"
        if key in spot_quotes:
            spot_price[idx_sym] = spot_quotes[key]["last_price"]
    log.info("  -> spot prices obtained for %d symbols", len(spot_price))

    # Step 3 — Build token -> instrument map for ATM ± 20 strikes per symbol.
    # Stocks get their single nearest expiry; index underlyings get their next
    # INDEX_EXPIRIES weekly expiries (each treated the same way from here on).
    token_to_meta: dict[int, dict] = {}   # token -> {symbol, expiry, strike, option_type}
    missing_symbols: list[str] = []
    all_symbols = fo_symbols + list(INDEX_SYMBOLS.keys())

    for sym in all_symbols:
        is_index = sym in INDEX_SYMBOLS
        if sym not in nfo_by_name:
            log.warning("  %s: no NFO instruments found — skipping", sym)
            missing_symbols.append(sym)
            continue
        if sym not in spot_price:
            log.warning("  %s: no spot quote — skipping", sym)
            missing_symbols.append(sym)
            continue

        insts = nfo_by_name[sym]
        expiries = list({inst["expiry"] for inst in insts if isinstance(inst["expiry"], date)})
        if is_index:
            today_ = date.today()
            selected_expiries = sorted(e for e in expiries if e >= today_)[:INDEX_EXPIRIES]
        else:
            nearest = _nearest_monthly_expiry(expiries)
            selected_expiries = [nearest] if nearest else []
        if not selected_expiries:
            log.warning("  %s: no current expiry found — skipping", sym)
            continue

        for expiry in selected_expiries:
            curr = [i for i in insts if i["expiry"] == expiry]
            strikes = sorted({i["strike"] for i in curr})
            if not strikes:
                log.warning("  %s: no strikes for expiry %s — skipping", sym, expiry)
                continue

            interval = _detect_strike_interval(strikes)
            atm = _atm_strike(spot_price[sym], interval)

            # Select ATM ± 20 strikes (both CE and PE)
            lo = atm - STRIKES_EACH_SIDE * interval
            hi = atm + STRIKES_EACH_SIDE * interval
            selected = [i for i in curr if lo <= i["strike"] <= hi]

            for inst in selected:
                token_to_meta[inst["instrument_token"]] = {
                    "symbol":      sym,
                    "expiry":      expiry.isoformat(),
                    "strike":      float(inst["strike"]),
                    "option_type": inst["instrument_type"],
                    "lot_size":    int(inst["lot_size"]),
                }

    log.info("Selected %d option instruments across %d symbols",
             len(token_to_meta), len(all_symbols) - len(missing_symbols))

    # Step 4 — Batch quote all tokens (500 per call)
    all_tokens = list(token_to_meta.keys())
    raw_quotes: dict[int, dict] = {}

    for i in range(0, len(all_tokens), BATCH_SIZE):
        batch = all_tokens[i : i + BATCH_SIZE]
        log.info("  Quoting batch %d–%d of %d …",
                 i + 1, min(i + BATCH_SIZE, len(all_tokens)), len(all_tokens))
        try:
            quotes = kite.quote(batch)
            for token, q in quotes.items():
                raw_quotes[int(token)] = q
        except Exception as exc:
            log.error("  Batch %d failed: %s", i // BATCH_SIZE + 1, exc)
        time.sleep(CALL_SLEEP)

    log.info("Received quotes for %d instruments", len(raw_quotes))

    # Step 5 — Compute T (time to expiry in years) per unique expiry date
    t_map: dict[str, float] = {}
    for meta in token_to_meta.values():
        exp_str = meta["expiry"]
        if exp_str not in t_map:
            exp_date = date.fromisoformat(exp_str)
            # Use market hours end (15:30 IST) as expiry moment
            days = (exp_date - today).days + 1   # +1 for remainder of today
            t_map[exp_str] = max(days / 365.0, 0.0)

    # Step 6 — Build rows
    rows: list[dict] = []
    today_str = write_date.isoformat()
    prev_oi_map = _load_prev_oi_map(write_date)

    for token, q in raw_quotes.items():
        meta = token_to_meta.get(token)
        if meta is None:
            continue

        sym       = meta["symbol"]
        expiry    = meta["expiry"]
        strike    = meta["strike"]
        opt_type  = meta["option_type"]
        spot      = spot_price.get(sym, 0.0)
        T         = t_map.get(expiry, 0.0)

        ltp       = q.get("last_price", 0.0) or 0.0
        volume    = q.get("volume", 0) or 0
        oi        = q.get("oi", 0) or 0

        depth     = q.get("depth", {})
        bid       = depth.get("buy",  [{}])[0].get("price", 0.0) or 0.0
        ask       = depth.get("sell", [{}])[0].get("price", 0.0) or 0.0

        prev_oi_val = prev_oi_map.get((sym, strike, opt_type, expiry))
        oi_change   = (oi - prev_oi_val) if prev_oi_val is not None else None

        iv = compute_iv(ltp, spot, strike, T, opt_type) if ltp > 0 and spot > 0 else None

        rows.append({
            "date":             today_str,
            "symbol":           sym,
            "expiry":           expiry,
            "strike":           strike,
            "option_type":      opt_type,
            "underlying_price": spot,
            "ltp":              ltp,
            "bid":              bid,
            "ask":              ask,
            "oi":               oi,
            "oi_change":        oi_change,
            "volume":           volume,
            "iv":               iv,
        })

    if not rows:
        log.error("No rows produced — nothing to write.")
        return

    # Step 7 — Write parquet
    df = pl.DataFrame(rows, schema={
        "date":             pl.Utf8,
        "symbol":           pl.Utf8,
        "expiry":           pl.Utf8,
        "strike":           pl.Float64,
        "option_type":      pl.Utf8,
        "underlying_price": pl.Float64,
        "ltp":              pl.Float64,
        "bid":              pl.Float64,
        "ask":              pl.Float64,
        "oi":               pl.Int64,
        "oi_change":        pl.Int64,
        "volume":           pl.Int64,
        "iv":               pl.Float64,
    })

    out_dir = LAKE_ROOT / f"date={today_str}"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "data.parquet"
    df.write_parquet(out_path, compression="zstd", compression_level=3)

    log.info(
        "Written %d rows -> %s  (%.1f KB)",
        len(df), out_path, out_path.stat().st_size / 1024,
    )

    # Summary
    syms_written = df["symbol"].n_unique()
    atm_missing  = [s for s in all_symbols if s not in {r["symbol"] for r in rows}]
    log.info("Symbols with data: %d / %d", syms_written, len(all_symbols))
    if atm_missing:
        log.warning("Symbols with no data written: %s", ", ".join(atm_missing))

    # Refresh DuckDB options_chain view so it covers today's partition
    try:
        con = get_connection()
        con.execute(f"""
            CREATE OR REPLACE VIEW options_chain AS
            SELECT * FROM read_parquet('{LAKE_ROOT.as_posix()}/date=*/data.parquet',
                                       hive_partitioning = true)
        """)
        row_count = con.execute("SELECT COUNT(*) FROM options_chain WHERE date = ?",
                                [today_str]).fetchone()[0]
        log.info("DuckDB options_chain view refreshed — %d rows for %s", row_count, today_str)
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
    ingest_option_chain(label_date=label)
