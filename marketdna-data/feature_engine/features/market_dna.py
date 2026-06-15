"""Market DNA composite score. 100% DuckDB aggregation across feature parquets."""
import logging
import time

import duckdb
import polars as pl

from feature_engine.writers.feature_writer import write_feature

log = logging.getLogger(__name__)
NAME = "market_dna"

_SRC_DNA     = "data_lake/features/stock_dna.parquet"
_SRC_BREADTH = "data_lake/features/breadth.parquet"


def _market_label(score: float) -> str:
    if score >= 70:
        return "Expansion"
    if score >= 50:
        return "Recovery"
    if score >= 30:
        return "Contraction"
    return "Recession"


def compute(incremental: bool = False) -> pl.DataFrame:
    """Compute market_dna from stock_dna + breadth parquets. Always full recompute."""
    t0 = time.perf_counter()

    con = duckdb.connect()
    df = con.execute(f"""
        SELECT
            s.date,
            ROUND(b.breadth_score,         2) AS breadth_score,
            ROUND(AVG(s.regime_score),     2) AS avg_regime_score,
            ROUND(GREATEST(0.0, 100.0 + AVG(s.drawdown_pct) * 2.0), 2) AS stress_score,
            ROUND(
                SUM(CASE WHEN s.rs_score > 60.0 AND s.regime_score > 60.0
                    THEN 1.0 ELSE 0.0 END)
                / NULLIF(COUNT(*), 0) * 100.0,
                2
            ) AS leadership_score,
            ROUND(
                b.breadth_score * 0.30 +
                AVG(s.regime_score) * 0.30 +
                (SUM(CASE WHEN s.rs_score > 60.0 AND s.regime_score > 60.0
                     THEN 1.0 ELSE 0.0 END)
                 / NULLIF(COUNT(*), 0) * 100.0) * 0.25 +
                GREATEST(0.0, 100.0 + AVG(s.drawdown_pct) * 2.0) * 0.15,
                2
            ) AS market_dna_score
        FROM read_parquet('{_SRC_DNA}')     s
        JOIN read_parquet('{_SRC_BREADTH}') b ON s.date = b.date
        GROUP BY s.date, b.breadth_score
        ORDER BY s.date
    """).pl()
    con.close()

    df = df.with_columns(
        pl.col("market_dna_score")
        .map_elements(_market_label, return_dtype=pl.Utf8)
        .alias("market_dna_label")
    )

    log.info("%s: %d rows in %.1fs", NAME, len(df), time.perf_counter() - t0)
    return df
