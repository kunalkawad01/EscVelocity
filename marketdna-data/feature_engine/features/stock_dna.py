"""Stock DNA composite score. 100% DuckDB JOIN across feature parquets."""
import logging
import time

import duckdb
import polars as pl

from feature_engine.writers.feature_writer import write_feature

log = logging.getLogger(__name__)
NAME = "stock_dna"

_SRC = {
    "regime":    "data_lake/features/sma_regime.parquet",
    "drawdown":  "data_lake/features/drawdown_recovery.parquet",
    "rs":        "data_lake/features/relative_strength.parquet",
    "rv":        "data_lake/features/returns_vol.parquet",
}


def _dna_label(score: float) -> str:
    if score >= 80:
        return "Tier 1"
    if score >= 60:
        return "Tier 2"
    if score >= 40:
        return "Tier 3"
    return "Avoid"


def compute(incremental: bool = False) -> pl.DataFrame:
    """Compute stock_dna from joined feature parquets. Always full recompute."""
    t0 = time.perf_counter()

    con = duckdb.connect()
    df = con.execute(f"""
        WITH base AS (
            SELECT
                r.symbol, r.date,
                r.regime_score,
                rec.recovery_score,
                rec.drawdown_pct,
                rs.rs_score,
                rv.return_20d,
                rv.vol_21d
            FROM read_parquet('{_SRC["regime"]}')   r
            JOIN read_parquet('{_SRC["drawdown"]}') rec ON r.symbol = rec.symbol AND r.date = rec.date
            JOIN read_parquet('{_SRC["rs"]}')       rs  ON r.symbol = rs.symbol  AND r.date = rs.date
            JOIN read_parquet('{_SRC["rv"]}')       rv  ON r.symbol = rv.symbol  AND r.date = rv.date
            WHERE rv.vol_21d IS NOT NULL AND rs.rs_score IS NOT NULL
        ),
        scored AS (
            SELECT *,
                GREATEST(0.0, LEAST(100.0,
                    50.0 + (return_20d / NULLIF(vol_21d, 0)) * 10.0
                )) AS efficiency_score,
                GREATEST(0.0, 100.0 + drawdown_pct * 2.0) AS drawdown_score
            FROM base
        )
        SELECT
            symbol, date,
            ROUND(regime_score,      2) AS regime_score,
            ROUND(recovery_score,    2) AS recovery_score,
            ROUND(drawdown_pct,      4) AS drawdown_pct,
            ROUND(rs_score,          2) AS rs_score,
            ROUND(efficiency_score,  2) AS efficiency_score,
            ROUND(
                regime_score     * 0.35 +
                rs_score         * 0.25 +
                recovery_score   * 0.20 +
                drawdown_score   * 0.10 +
                efficiency_score * 0.10,
                2
            ) AS stock_dna_score
        FROM scored
        ORDER BY symbol, date
    """).pl()
    con.close()

    df = df.with_columns(
        pl.col("stock_dna_score")
        .map_elements(_dna_label, return_dtype=pl.Utf8)
        .alias("stock_dna_label")
    )

    log.info("%s: %d rows in %.1fs", NAME, len(df), time.perf_counter() - t0)
    return df
