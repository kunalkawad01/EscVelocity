"""Multi-horizon returns + realized vol + ATR for all 500 symbols."""
import logging
import time

import numpy as np
import polars as pl

from feature_engine.features._base import (
    warm_up_where, filter_new_rows, merge_incremental, wilder,
)
from feature_engine.writers.feature_writer import write_feature
from warehouse.register_views import get_connection

log = logging.getLogger(__name__)
NAME = "returns_vol"

_KEEP_COLS = [
    "symbol", "date",
    "return_1d", "return_5d", "return_20d", "return_63d", "return_252d",
    "vol_21d", "atr_14", "atr_pct",
]


def compute(incremental: bool = False) -> pl.DataFrame:
    """Compute returns_vol feature. Returns full merged DataFrame."""
    t0 = time.perf_counter()
    where_clause = warm_up_where(NAME, buffer_days=500) if incremental else ""

    con = get_connection()
    df_raw = con.execute(f"""
        WITH base AS (
            SELECT
                symbol,
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                close, high, low,
                LAG(close, 1)   OVER (PARTITION BY symbol ORDER BY date) AS prev_close,
                LAG(close, 5)   OVER (PARTITION BY symbol ORDER BY date) AS close_5d,
                LAG(close, 20)  OVER (PARTITION BY symbol ORDER BY date) AS close_20d,
                LAG(close, 63)  OVER (PARTITION BY symbol ORDER BY date) AS close_63d,
                LAG(close, 252) OVER (PARTITION BY symbol ORDER BY date) AS close_252d,
                ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date) AS rn
            FROM equities_prices
            WHERE 1=1 {where_clause}
        )
        SELECT
            symbol, date, close, high, low, prev_close,
            ROUND((close - prev_close) / NULLIF(prev_close, 0) * 100.0, 6) AS return_1d,
            ROUND((close - close_5d)   / NULLIF(close_5d,   0) * 100.0, 4) AS return_5d,
            ROUND((close - close_20d)  / NULLIF(close_20d,  0) * 100.0, 4) AS return_20d,
            ROUND((close - close_63d)  / NULLIF(close_63d,  0) * 100.0, 4) AS return_63d,
            ROUND((close - close_252d) / NULLIF(close_252d, 0) * 100.0, 4) AS return_252d,
            ROUND(
                STDDEV_SAMP((close - prev_close) / NULLIF(prev_close, 0) * 100.0)
                OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 20 PRECEDING AND CURRENT ROW)
                * SQRT(252.0),
                4
            ) AS vol_21d,
            GREATEST(
                high - low,
                ABS(high - prev_close),
                ABS(low  - prev_close)
            ) AS true_range
        FROM base
        WHERE rn >= 2
        ORDER BY symbol, date
    """).pl()

    # ATR(14) via Wilder smoothing — requires per-symbol Python loop
    results: list[pl.DataFrame] = []
    for sym_df in df_raw.partition_by("symbol", maintain_order=True):
        tr = sym_df["true_range"].fill_null(0.0).to_numpy()
        atr_sum = wilder(tr, 14)
        atr14 = atr_sum / 14.0  # convert Wilder sum to average ATR
        closes = sym_df["close"].to_numpy()
        sym_df = sym_df.with_columns([
            pl.Series("atr_14",  np.round(atr14, 4)),
            pl.Series("atr_pct", np.round(atr14 / (closes + 1e-9) * 100.0, 4)),
        ])
        results.append(sym_df)

    df = pl.concat(results).select(_KEEP_COLS)

    if incremental:
        df = filter_new_rows(df, NAME)
        df = merge_incremental(NAME, df, ["symbol", "date"])

    log.info("%s: %d rows in %.1fs", NAME, len(df), time.perf_counter() - t0)
    return df
