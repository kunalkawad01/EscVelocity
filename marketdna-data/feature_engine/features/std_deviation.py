"""
std_deviation.py
================
Rolling standard deviation of daily returns at 11 horizons for all NSE symbols.

Output columns:
    symbol, date,
    std_1d, std_2d, std_5d, std_10d, std_20d, std_50d,
    std_1y, std_2y, std_3y, std_4y, std_5y

All values are in % (raw std of daily return %). Rounded to 4 decimal places.
"""

import logging
import time

import polars as pl

from warehouse.register_views import get_connection
from feature_engine.features._base import warm_up_where, filter_new_rows, merge_incremental

log = logging.getLogger(__name__)

NAME = "std_deviation"

_SQL = """
WITH daily_ret AS (
    SELECT
        symbol,
        STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
        (close / NULLIF(LAG(close, 1) OVER (PARTITION BY symbol ORDER BY date), 0) - 1) * 100 AS ret_1d
    FROM equities_prices
    WHERE 1=1 {where_clause}
)
SELECT
    symbol,
    date,
    ROUND(STDDEV_SAMP(ret_1d) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 0    PRECEDING AND CURRENT ROW), 4) AS std_1d,
    ROUND(STDDEV_SAMP(ret_1d) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 1    PRECEDING AND CURRENT ROW), 4) AS std_2d,
    ROUND(STDDEV_SAMP(ret_1d) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 4    PRECEDING AND CURRENT ROW), 4) AS std_5d,
    ROUND(STDDEV_SAMP(ret_1d) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 9    PRECEDING AND CURRENT ROW), 4) AS std_10d,
    ROUND(STDDEV_SAMP(ret_1d) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 19   PRECEDING AND CURRENT ROW), 4) AS std_20d,
    ROUND(STDDEV_SAMP(ret_1d) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 49   PRECEDING AND CURRENT ROW), 4) AS std_50d,
    ROUND(STDDEV_SAMP(ret_1d) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 251  PRECEDING AND CURRENT ROW), 4) AS std_1y,
    ROUND(STDDEV_SAMP(ret_1d) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 503  PRECEDING AND CURRENT ROW), 4) AS std_2y,
    ROUND(STDDEV_SAMP(ret_1d) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 755  PRECEDING AND CURRENT ROW), 4) AS std_3y,
    ROUND(STDDEV_SAMP(ret_1d) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 1007 PRECEDING AND CURRENT ROW), 4) AS std_4y,
    ROUND(STDDEV_SAMP(ret_1d) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 1259 PRECEDING AND CURRENT ROW), 4) AS std_5y
FROM daily_ret
ORDER BY symbol, date
"""


def compute(incremental: bool = False) -> pl.DataFrame:
    """Compute rolling standard deviation of daily returns at 11 horizons.

    Parameters
    ----------
    incremental:
        When True, only processes rows newer than what is already stored in the
        feature parquet (with a 1400-day warm-up buffer to correctly populate
        long-horizon windows). When False, recomputes the full history.

    Returns
    -------
    pl.DataFrame
        Full dataset (existing + new rows) with columns:
        symbol, date, std_1d, std_2d, std_5d, std_10d, std_20d, std_50d,
        std_1y, std_2y, std_3y, std_4y, std_5y.
    """
    t0 = time.perf_counter()

    where_clause = warm_up_where(NAME, buffer_days=1400) if incremental else ""

    con = get_connection()
    df = con.execute(_SQL.format(where_clause=where_clause)).pl()

    if incremental:
        df = filter_new_rows(df, NAME)
        df = merge_incremental(NAME, df, ["symbol", "date"])

    log.info("%s: %d rows in %.1fs", NAME, len(df), time.perf_counter() - t0)
    return df
