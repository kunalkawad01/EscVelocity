"""Multi-horizon price returns for all 500 NSE symbols. 100% DuckDB."""
import logging
import time

import polars as pl

from feature_engine.features._base import (
    warm_up_where, filter_new_rows, merge_incremental,
)
from warehouse.register_views import get_connection

log = logging.getLogger(__name__)
NAME = "returns"


def compute(incremental: bool = False) -> pl.DataFrame:
    """Compute multi-horizon returns feature. Returns full merged DataFrame.

    Output columns
    --------------
    symbol, date,
    ret_1d, ret_2d, ret_5d, ret_10d, ret_20d, ret_50d,
    ret_1y, ret_2y, ret_3y, ret_4y, ret_5y,
    cagr_1y, cagr_2y, cagr_3y, cagr_4y, cagr_5y

    Simple returns are expressed as percentages (%).
    CAGR values are annualised percentages (%).
    All values are rounded to 4 decimal places.
    """
    t0 = time.perf_counter()
    where_clause = warm_up_where(NAME, buffer_days=1400) if incremental else ""

    con = get_connection()
    df = con.execute(f"""
        SELECT
            symbol,
            STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,

            -- Simple returns (%)
            ROUND(
                (close - LAG(close, 1)    OVER (PARTITION BY symbol ORDER BY date))
                / NULLIF(LAG(close, 1)    OVER (PARTITION BY symbol ORDER BY date), 0)
                * 100,
            4) AS ret_1d,

            ROUND(
                (close - LAG(close, 2)    OVER (PARTITION BY symbol ORDER BY date))
                / NULLIF(LAG(close, 2)    OVER (PARTITION BY symbol ORDER BY date), 0)
                * 100,
            4) AS ret_2d,

            ROUND(
                (close - LAG(close, 5)    OVER (PARTITION BY symbol ORDER BY date))
                / NULLIF(LAG(close, 5)    OVER (PARTITION BY symbol ORDER BY date), 0)
                * 100,
            4) AS ret_5d,

            ROUND(
                (close - LAG(close, 10)   OVER (PARTITION BY symbol ORDER BY date))
                / NULLIF(LAG(close, 10)   OVER (PARTITION BY symbol ORDER BY date), 0)
                * 100,
            4) AS ret_10d,

            ROUND(
                (close - LAG(close, 20)   OVER (PARTITION BY symbol ORDER BY date))
                / NULLIF(LAG(close, 20)   OVER (PARTITION BY symbol ORDER BY date), 0)
                * 100,
            4) AS ret_20d,

            ROUND(
                (close - LAG(close, 50)   OVER (PARTITION BY symbol ORDER BY date))
                / NULLIF(LAG(close, 50)   OVER (PARTITION BY symbol ORDER BY date), 0)
                * 100,
            4) AS ret_50d,

            ROUND(
                (close - LAG(close, 252)  OVER (PARTITION BY symbol ORDER BY date))
                / NULLIF(LAG(close, 252)  OVER (PARTITION BY symbol ORDER BY date), 0)
                * 100,
            4) AS ret_1y,

            ROUND(
                (close - LAG(close, 504)  OVER (PARTITION BY symbol ORDER BY date))
                / NULLIF(LAG(close, 504)  OVER (PARTITION BY symbol ORDER BY date), 0)
                * 100,
            4) AS ret_2y,

            ROUND(
                (close - LAG(close, 756)  OVER (PARTITION BY symbol ORDER BY date))
                / NULLIF(LAG(close, 756)  OVER (PARTITION BY symbol ORDER BY date), 0)
                * 100,
            4) AS ret_3y,

            ROUND(
                (close - LAG(close, 1008) OVER (PARTITION BY symbol ORDER BY date))
                / NULLIF(LAG(close, 1008) OVER (PARTITION BY symbol ORDER BY date), 0)
                * 100,
            4) AS ret_4y,

            ROUND(
                (close - LAG(close, 1260) OVER (PARTITION BY symbol ORDER BY date))
                / NULLIF(LAG(close, 1260) OVER (PARTITION BY symbol ORDER BY date), 0)
                * 100,
            4) AS ret_5y,

            -- Annualised CAGR (%)
            ROUND(
                (POWER(
                    close / NULLIF(LAG(close, 252)  OVER (PARTITION BY symbol ORDER BY date), 0),
                    252.0 / 252.0
                ) - 1) * 100,
            4) AS cagr_1y,

            ROUND(
                (POWER(
                    close / NULLIF(LAG(close, 504)  OVER (PARTITION BY symbol ORDER BY date), 0),
                    252.0 / 504.0
                ) - 1) * 100,
            4) AS cagr_2y,

            ROUND(
                (POWER(
                    close / NULLIF(LAG(close, 756)  OVER (PARTITION BY symbol ORDER BY date), 0),
                    252.0 / 756.0
                ) - 1) * 100,
            4) AS cagr_3y,

            ROUND(
                (POWER(
                    close / NULLIF(LAG(close, 1008) OVER (PARTITION BY symbol ORDER BY date), 0),
                    252.0 / 1008.0
                ) - 1) * 100,
            4) AS cagr_4y,

            ROUND(
                (POWER(
                    close / NULLIF(LAG(close, 1260) OVER (PARTITION BY symbol ORDER BY date), 0),
                    252.0 / 1260.0
                ) - 1) * 100,
            4) AS cagr_5y

        FROM equities_prices
        WHERE 1=1 {where_clause}
        ORDER BY symbol, date
    """).pl()

    if incremental:
        df = filter_new_rows(df, NAME)
        df = merge_incremental(NAME, df, ["symbol", "date"])

    log.info("%s: %d rows in %.1fs", NAME, len(df), time.perf_counter() - t0)
    return df
