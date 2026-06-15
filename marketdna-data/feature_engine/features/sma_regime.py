"""SMAs (20/50/100/200) + Regime Score for all 500 symbols. 100% DuckDB."""
import logging
import time

import polars as pl

from feature_engine.features._base import (
    FEATURES_DIR, warm_up_where, filter_new_rows, merge_incremental,
)
from feature_engine.writers.feature_writer import write_feature
from warehouse.register_views import get_connection

log = logging.getLogger(__name__)
NAME = "sma_regime"


def _regime_label(score: int) -> str:
    if score >= 80:
        return "Strong Bull"
    if score >= 60:
        return "Moderate Bull"
    if score >= 40:
        return "Neutral"
    if score >= 20:
        return "Moderate Bear"
    return "Strong Bear"


def compute(incremental: bool = False) -> pl.DataFrame:
    """Compute sma_regime feature. Returns full merged DataFrame."""
    t0 = time.perf_counter()
    where_clause = warm_up_where(NAME) if incremental else ""

    con = get_connection()
    df = con.execute(f"""
        WITH sma_calc AS (
            SELECT
                symbol,
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                close,
                ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date) AS rn,
                AVG(close) OVER (PARTITION BY symbol ORDER BY date
                    ROWS BETWEEN 19  PRECEDING AND CURRENT ROW) AS sma20,
                AVG(close) OVER (PARTITION BY symbol ORDER BY date
                    ROWS BETWEEN 49  PRECEDING AND CURRENT ROW) AS sma50,
                AVG(close) OVER (PARTITION BY symbol ORDER BY date
                    ROWS BETWEEN 99  PRECEDING AND CURRENT ROW) AS sma100,
                AVG(close) OVER (PARTITION BY symbol ORDER BY date
                    ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS sma200
            FROM equities_prices
            WHERE 1=1 {where_clause}
        ),
        with_slopes AS (
            SELECT *,
                LAG(sma20,  5)  OVER (PARTITION BY symbol ORDER BY date) AS sma20_lag,
                LAG(sma50,  10) OVER (PARTITION BY symbol ORDER BY date) AS sma50_lag,
                LAG(sma200, 20) OVER (PARTITION BY symbol ORDER BY date) AS sma200_lag
            FROM sma_calc
            WHERE rn >= 20
        )
        SELECT
            symbol, date,
            ROUND(close,   4) AS close,
            ROUND(sma20,   4) AS sma20,
            ROUND(sma50,   4) AS sma50,
            ROUND(sma100,  4) AS sma100,
            ROUND(sma200,  4) AS sma200,
            (CASE WHEN close > sma20  THEN 10 ELSE 0 END +
             CASE WHEN close > sma50  THEN 10 ELSE 0 END +
             CASE WHEN close > sma100 THEN 10 ELSE 0 END +
             CASE WHEN close > sma200 THEN 10 ELSE 0 END)  AS price_score,
            (CASE WHEN sma20  > sma50   THEN 10 ELSE 0 END +
             CASE WHEN sma50  > sma100  THEN 10 ELSE 0 END +
             CASE WHEN sma100 > sma200  THEN 10 ELSE 0 END) AS alignment_score,
            (CASE WHEN sma20_lag  IS NOT NULL AND sma20  > sma20_lag  THEN 10 ELSE 0 END +
             CASE WHEN sma50_lag  IS NOT NULL AND sma50  > sma50_lag  THEN 10 ELSE 0 END +
             CASE WHEN sma200_lag IS NOT NULL AND sma200 > sma200_lag THEN 10 ELSE 0 END) AS slope_score,
            (CASE WHEN close > sma20  THEN 10 ELSE 0 END +
             CASE WHEN close > sma50  THEN 10 ELSE 0 END +
             CASE WHEN close > sma100 THEN 10 ELSE 0 END +
             CASE WHEN close > sma200 THEN 10 ELSE 0 END +
             CASE WHEN sma20  > sma50   THEN 10 ELSE 0 END +
             CASE WHEN sma50  > sma100  THEN 10 ELSE 0 END +
             CASE WHEN sma100 > sma200  THEN 10 ELSE 0 END +
             CASE WHEN sma20_lag  IS NOT NULL AND sma20  > sma20_lag  THEN 10 ELSE 0 END +
             CASE WHEN sma50_lag  IS NOT NULL AND sma50  > sma50_lag  THEN 10 ELSE 0 END +
             CASE WHEN sma200_lag IS NOT NULL AND sma200 > sma200_lag THEN 10 ELSE 0 END) AS regime_score
        FROM with_slopes
        ORDER BY symbol, date
    """).pl()

    df = df.with_columns(
        pl.col("regime_score")
        .map_elements(_regime_label, return_dtype=pl.Utf8)
        .alias("regime_label")
    )

    if incremental:
        df = filter_new_rows(df, NAME)
        df = merge_incremental(NAME, df, ["symbol", "date"])

    log.info("%s: %d rows in %.1fs", NAME, len(df), time.perf_counter() - t0)
    return df
