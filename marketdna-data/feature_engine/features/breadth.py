"""Market Breadth Score (NSE 500 + NIFTY50 subset). Reads sma_regime.parquet."""
import logging
import time

import duckdb
import polars as pl

from feature_engine.writers.feature_writer import write_feature

log = logging.getLogger(__name__)
NAME = "breadth"

NIFTY50 = [
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
]

_N50_IN = ", ".join(f"'{s}'" for s in NIFTY50)


def _breadth_label(score: float) -> str:
    if score >= 70:
        return "Broad Participation"
    if score >= 50:
        return "Moderate Breadth"
    if score >= 30:
        return "Narrow Breadth"
    return "Poor Breadth"


def compute(incremental: bool = False) -> pl.DataFrame:
    """Compute breadth from sma_regime.parquet. Always full recompute (fast, ~1601 rows)."""
    t0 = time.perf_counter()

    src = "data_lake/features/sma_regime.parquet"
    con = duckdb.connect()
    df = con.execute(f"""
        WITH all_syms AS (
            SELECT date,
                COUNT(*)                                                AS n_symbols,
                SUM(CASE WHEN close > sma20  THEN 1 ELSE 0 END)        AS above_sma20,
                SUM(CASE WHEN close > sma50  THEN 1 ELSE 0 END)        AS above_sma50,
                SUM(CASE WHEN close > sma200 THEN 1 ELSE 0 END)        AS above_sma200
            FROM read_parquet('{src}')
            GROUP BY date
        ),
        n50 AS (
            SELECT date,
                SUM(CASE WHEN close > sma20  THEN 1.0 ELSE 0.0 END) / COUNT(*) * 100.0 AS pct20,
                SUM(CASE WHEN close > sma50  THEN 1.0 ELSE 0.0 END) / COUNT(*) * 100.0 AS pct50,
                SUM(CASE WHEN close > sma200 THEN 1.0 ELSE 0.0 END) / COUNT(*) * 100.0 AS pct200
            FROM read_parquet('{src}')
            WHERE symbol IN ({_N50_IN})
            GROUP BY date
        )
        SELECT
            a.date,
            CAST(a.n_symbols   AS INTEGER) AS n_symbols,
            CAST(a.above_sma20 AS INTEGER) AS above_sma20,
            CAST(a.above_sma50 AS INTEGER) AS above_sma50,
            CAST(a.above_sma200 AS INTEGER) AS above_sma200,
            ROUND(a.above_sma20  * 100.0 / a.n_symbols, 2) AS pct_above_sma20,
            ROUND(a.above_sma50  * 100.0 / a.n_symbols, 2) AS pct_above_sma50,
            ROUND(a.above_sma200 * 100.0 / a.n_symbols, 2) AS pct_above_sma200,
            ROUND(a.above_sma20  * 100.0 / a.n_symbols * 0.30
                + a.above_sma50  * 100.0 / a.n_symbols * 0.40
                + a.above_sma200 * 100.0 / a.n_symbols * 0.30, 2) AS breadth_score,
            ROUND(COALESCE(n.pct20, 0) * 0.30
                + COALESCE(n.pct50, 0) * 0.40
                + COALESCE(n.pct200, 0) * 0.30, 2) AS nifty50_breadth_score
        FROM all_syms a
        LEFT JOIN n50 n ON a.date = n.date
        ORDER BY a.date
    """).pl()
    con.close()

    df = df.with_columns(
        pl.col("breadth_score")
        .map_elements(_breadth_label, return_dtype=pl.Utf8)
        .alias("breadth_label")
    )

    log.info("%s: %d rows in %.1fs", NAME, len(df), time.perf_counter() - t0)
    return df
