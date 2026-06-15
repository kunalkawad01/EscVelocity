"""Cross-sectional 20-day Relative Strength rank for all 500 symbols. 100% DuckDB."""
import logging
import time

import polars as pl

from feature_engine.features._base import warm_up_where, filter_new_rows, merge_incremental
from feature_engine.writers.feature_writer import write_feature
from warehouse.register_views import get_connection

log = logging.getLogger(__name__)
NAME = "relative_strength"


def compute(incremental: bool = False) -> pl.DataFrame:
    """Compute relative_strength feature. Returns full merged DataFrame."""
    t0 = time.perf_counter()
    where_clause = warm_up_where(NAME) if incremental else ""

    con = get_connection()
    df = con.execute(f"""
        WITH returns AS (
            SELECT
                symbol,
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                (close - LAG(close, 20) OVER (PARTITION BY symbol ORDER BY date))
                / NULLIF(LAG(close, 20) OVER (PARTITION BY symbol ORDER BY date), 0)
                * 100.0 AS return_20d
            FROM equities_prices
            WHERE 1=1 {where_clause}
        ),
        ranked AS (
            SELECT *,
                COUNT(*) OVER (PARTITION BY date) AS rs_total_symbols,
                RANK()   OVER (PARTITION BY date ORDER BY return_20d DESC NULLS LAST) AS rs_rank
            FROM returns
            WHERE return_20d IS NOT NULL
        )
        SELECT
            symbol, date,
            ROUND(return_20d, 4) AS return_20d,
            CAST(rs_rank          AS INTEGER) AS rs_rank,
            CAST(rs_total_symbols AS INTEGER) AS rs_total_symbols,
            ROUND(
                (1.0 - CAST(rs_rank - 1 AS DOUBLE)
                     / NULLIF(CAST(rs_total_symbols - 1 AS DOUBLE), 0)) * 100.0,
                2
            ) AS rs_score
        FROM ranked
        ORDER BY symbol, date
    """).pl()

    if incremental:
        df = filter_new_rows(df, NAME)
        df = merge_incremental(NAME, df, ["symbol", "date"])

    log.info("%s: %d rows in %.1fs", NAME, len(df), time.perf_counter() - t0)
    return df
