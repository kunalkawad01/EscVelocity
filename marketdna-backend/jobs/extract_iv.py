"""
IV history extraction — the clock that cannot be backfilled later.

Distills the raw daily option-chain parquet (ATM ±20 strikes, CE+PE, per-strike IV) into
one row per (date, symbol): the ATM implied volatility. This is the series that matures
into IV rank / IV premium edges (~60 sessions for a crude rank, 252 for a real one).

ATM IV definition (fixed — a change bumps IV_METHOD):
    mean of `iv` over all quotes (CE and PE) whose strike is within ±2% of the
    underlying price, requiring >= 2 finite quotes. Both sides included on purpose:
    averaging CE+PE at ATM cancels most call/put skew.

Output: data_lake/features/iv_history.parquet — columns
    date (str YYYY-MM-DD), symbol, atm_iv, n_quotes, underlying_price, method
Incremental: only dates missing from the feature file are extracted; existing rows are
never modified. The file is small (~210 rows/session), so a full rewrite on append is fine.

Usage (from marketdna-backend/, after option-chain ingestion):
    python -m jobs.extract_iv
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

import duckdb
import pandas as pd
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("extract_iv")

IV_METHOD = "atm_pm2pct_v1"
ATM_BAND = 0.02                # strikes within ±2% of underlying
MIN_QUOTES = 2

_DATA = Path(__file__).resolve().parent.parent.parent / "marketdna-data" / "data_lake"
_RAW = _DATA / "raw" / "options"
_OUT = _DATA / "features" / "iv_history.parquet"


def main() -> int:
    if not _RAW.exists():
        log.error("no options data at %s — run ingestion.ingest_option_chain first", _RAW)
        return 1

    existing = pd.DataFrame()
    have_dates: set[str] = set()
    if _OUT.exists():
        existing = pd.read_parquet(_OUT)
        have_dates = set(existing["date"].unique())

    con = duckdb.connect()
    con.execute(f"""
        CREATE VIEW oc AS SELECT * FROM read_parquet(
            '{_RAW.as_posix()}/**/*.parquet', hive_partitioning=1)
    """)
    all_dates = {str(r[0]) for r in con.execute("SELECT DISTINCT date FROM oc").fetchall()}
    todo = sorted(all_dates - have_dates)
    if not todo:
        log.info("iv_history is current (%d sessions) — nothing to do", len(have_dates))
        return 0

    inlist = ",".join(f"'{d}'" for d in todo)
    df = con.execute(f"""
        SELECT CAST(date AS VARCHAR) AS date, symbol,
               ROUND(AVG(iv), 2)            AS atm_iv,
               COUNT(*)                     AS n_quotes,
               ROUND(AVG(underlying_price), 2) AS underlying_price
        FROM oc
        WHERE CAST(date AS VARCHAR) IN ({inlist})
          AND iv IS NOT NULL AND iv > 0
          AND underlying_price > 0
          AND ABS(strike - underlying_price) / underlying_price <= {ATM_BAND}
        GROUP BY 1, 2
        HAVING COUNT(*) >= {MIN_QUOTES}
        ORDER BY 1, 2
    """).df()
    if df.empty:
        log.warning("no ATM IV rows extracted for %d new session(s)", len(todo))
        return 0
    df["method"] = IV_METHOD

    out = pd.concat([existing, df], ignore_index=True) if len(existing) else df
    _OUT.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(_OUT, index=False)
    log.info("extracted %d rows for %d new session(s) -> %s (total %d rows, %d sessions)",
             len(df), len(todo), _OUT.name, len(out), out["date"].nunique())
    return 0


if __name__ == "__main__":
    sys.exit(main())
