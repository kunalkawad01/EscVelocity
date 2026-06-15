"""Rolling 2Y drawdown + Recovery Score for all 500 symbols. 100% DuckDB."""
import logging
import time

import polars as pl

from feature_engine.features._base import warm_up_where, filter_new_rows, merge_incremental
from feature_engine.writers.feature_writer import write_feature
from warehouse.register_views import get_connection

log = logging.getLogger(__name__)
NAME = "drawdown_recovery"


def compute(incremental: bool = False) -> pl.DataFrame:
    """Compute drawdown_recovery feature. Returns full merged DataFrame."""
    t0 = time.perf_counter()
    where_clause = warm_up_where(NAME, buffer_days=760) if incremental else ""
    # buffer_days=760 covers the 503-bar (2Y) rolling peak window

    con = get_connection()
    df = con.execute(f"""
        WITH peaks AS (
            SELECT
                symbol,
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                close,
                MAX(close) OVER (
                    PARTITION BY symbol ORDER BY date
                    ROWS BETWEEN 503 PRECEDING AND CURRENT ROW
                ) AS rolling_peak_2y
            FROM equities_prices
            WHERE 1=1 {where_clause}
        )
        SELECT
            symbol, date,
            ROUND(close,          4) AS close,
            ROUND(rolling_peak_2y, 4) AS rolling_peak_2y,
            ROUND((close - rolling_peak_2y) / rolling_peak_2y * 100.0, 4) AS drawdown_pct,
            ROUND(GREATEST(0.0, 100.0 + (close - rolling_peak_2y) / rolling_peak_2y * 200.0), 2)
                AS recovery_score
        FROM peaks
        ORDER BY symbol, date
    """).pl()

    if incremental:
        df = filter_new_rows(df, NAME)
        df = merge_incremental(NAME, df, ["symbol", "date"])

    log.info("%s: %d rows in %.1fs", NAME, len(df), time.perf_counter() - t0)
    return df
