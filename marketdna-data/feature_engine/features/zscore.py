"""252-day Z-Score + absolute momentum for all 500 symbols. 100% DuckDB."""
import logging
import time

import polars as pl

from feature_engine.features._base import warm_up_where, filter_new_rows, merge_incremental
from feature_engine.writers.feature_writer import write_feature
from warehouse.register_views import get_connection

log = logging.getLogger(__name__)
NAME = "zscore"


def compute(incremental: bool = False) -> pl.DataFrame:
    """Compute zscore feature. Returns full merged DataFrame."""
    t0 = time.perf_counter()
    where_clause = warm_up_where(NAME, buffer_days=500) if incremental else ""
    # buffer_days=500 ensures 252 trading-day warm-up (252 * 1.4 calendar days)

    con = get_connection()
    df = con.execute(f"""
        WITH base AS (
            SELECT
                symbol,
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                close,
                LAG(close, 252) OVER (PARTITION BY symbol ORDER BY date) AS close_252d_ago,
                AVG(close)       OVER (PARTITION BY symbol ORDER BY date
                    ROWS BETWEEN 251 PRECEDING AND CURRENT ROW) AS mean_252d,
                STDDEV_SAMP(close) OVER (PARTITION BY symbol ORDER BY date
                    ROWS BETWEEN 251 PRECEDING AND CURRENT ROW) AS std_252d
            FROM equities_prices
            WHERE 1=1 {where_clause}
        )
        SELECT
            symbol, date,
            ROUND((close - mean_252d) / NULLIF(std_252d, 0), 4) AS zscore_252d,
            ROUND((close - close_252d_ago) / NULLIF(close_252d_ago, 0) * 100.0, 4) AS abs_mom_252d
        FROM base
        WHERE close_252d_ago IS NOT NULL
          AND std_252d IS NOT NULL
          AND std_252d > 0
        ORDER BY symbol, date
    """).pl()

    if incremental:
        df = filter_new_rows(df, NAME)
        df = merge_incremental(NAME, df, ["symbol", "date"])

    log.info("%s: %d rows in %.1fs", NAME, len(df), time.perf_counter() - t0)
    return df
