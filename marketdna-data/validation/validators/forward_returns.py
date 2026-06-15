"""Forward-return IC and decile analysis for each score column.

For each score, computes:
  - Spearman IC vs forward returns at 1d / 5d / 20d / 63d horizons
  - Mean forward return per decile (1 = lowest score, 10 = highest)
  - Monotonicity ratio: fraction of adjacent decile pairs where higher decile > lower
  - Decile spread: D10 mean fwd_return - D1 mean fwd_return
  - t-stat on spread (annualised)

Data source: JOIN stock_dna + sma_regime (for close) + equities_prices (for LEAD(close)).
Forward return computed as LEAD(close, N) from raw OHLCV via DuckDB.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import NamedTuple

import duckdb
import numpy as np
import polars as pl
from scipy import stats

log = logging.getLogger(__name__)

# Score columns to validate -> descriptive name
SCORE_COLS: dict[str, str] = {
    "regime_score":     "Regime Score",
    "rs_score":         "Relative Strength",
    "recovery_score":   "Recovery Score",
    "efficiency_score": "Efficiency Score",
    "stock_dna_score":  "Stock DNA Score",
}

HORIZONS = [1, 5, 20, 63]   # trading days
HORIZON_LABELS = {1: "1d", 5: "5d", 20: "20d", 63: "63d"}

_STOCK_DNA  = "data_lake/features/stock_dna.parquet"
_SMA_REGIME = "data_lake/features/sma_regime.parquet"
_RAW_GLOB   = "data_lake/raw/equities/**/*.parquet"


class HorizonResult(NamedTuple):
    horizon: str
    ic: float
    ic_pvalue: float
    decile_means: list[float]      # D1..D10 mean forward return %
    spread: float                  # D10 - D1
    monotonicity: float            # fraction of adjacent pairs with correct direction
    t_stat: float


class ScoreResult(NamedTuple):
    score_col: str
    label: str
    n_obs: int
    horizons: list[HorizonResult]


def _load_base() -> pl.DataFrame:
    """Load stock_dna joined with forward returns at all horizons."""
    con = duckdb.connect()
    df = con.execute(f"""
        WITH raw AS (
            SELECT
                symbol,
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                close
            FROM read_parquet('{_RAW_GLOB}', hive_partitioning=true)
        ),
        with_fwd AS (
            SELECT
                symbol, date, close,
                LEAD(close, 1)  OVER (PARTITION BY symbol ORDER BY date) AS close_fwd1,
                LEAD(close, 5)  OVER (PARTITION BY symbol ORDER BY date) AS close_fwd5,
                LEAD(close, 20) OVER (PARTITION BY symbol ORDER BY date) AS close_fwd20,
                LEAD(close, 63) OVER (PARTITION BY symbol ORDER BY date) AS close_fwd63
            FROM raw
        ),
        fwd_returns AS (
            SELECT
                symbol, date,
                (close_fwd1  - close) / NULLIF(close, 0) * 100 AS fwd_1d,
                (close_fwd5  - close) / NULLIF(close, 0) * 100 AS fwd_5d,
                (close_fwd20 - close) / NULLIF(close, 0) * 100 AS fwd_20d,
                (close_fwd63 - close) / NULLIF(close, 0) * 100 AS fwd_63d
            FROM with_fwd
            WHERE close_fwd1 IS NOT NULL
        )
        SELECT
            d.symbol, d.date,
            d.regime_score, d.rs_score, d.recovery_score,
            d.efficiency_score, d.stock_dna_score,
            f.fwd_1d, f.fwd_5d, f.fwd_20d, f.fwd_63d
        FROM read_parquet('{_STOCK_DNA}') d
        JOIN fwd_returns f ON d.symbol = f.symbol AND d.date = f.date
        WHERE f.fwd_1d IS NOT NULL
        ORDER BY d.date, d.symbol
    """).pl()
    con.close()
    return df


def _ic_for_col(scores: np.ndarray, fwd: np.ndarray) -> tuple[float, float]:
    """Spearman IC and p-value between score and forward return arrays."""
    mask = ~(np.isnan(scores) | np.isnan(fwd))
    if mask.sum() < 30:
        return float("nan"), float("nan")
    r, p = stats.spearmanr(scores[mask], fwd[mask])
    return float(r), float(p)


def _decile_analysis(scores: np.ndarray, fwd: np.ndarray) -> tuple[list[float], float, float, float]:
    """Compute per-decile mean fwd return, spread, monotonicity, t-stat."""
    mask = ~(np.isnan(scores) | np.isnan(fwd))
    sc = scores[mask]
    fw = fwd[mask]
    if len(sc) < 100:
        nans = [float("nan")] * 10
        return nans, float("nan"), float("nan"), float("nan")

    # Assign decile (1=lowest score, 10=highest)
    quantiles = np.percentile(sc, np.linspace(0, 100, 11))
    decile_means = []
    d1_vals, d10_vals = np.array([]), np.array([])

    for d in range(1, 11):
        lo = quantiles[d - 1]
        hi = quantiles[d]
        if d == 10:
            mask_d = (sc >= lo)
        else:
            mask_d = (sc >= lo) & (sc < hi)
        vals = fw[mask_d]
        decile_means.append(float(vals.mean()) if len(vals) > 0 else float("nan"))
        if d == 1:
            d1_vals = vals
        elif d == 10:
            d10_vals = vals

    spread = decile_means[-1] - decile_means[0]

    # Monotonicity: fraction of adjacent pairs where higher decile > lower
    valid_pairs = [(decile_means[i], decile_means[i + 1])
                   for i in range(9)
                   if not (np.isnan(decile_means[i]) or np.isnan(decile_means[i + 1]))]
    if valid_pairs:
        monotonicity = sum(b > a for a, b in valid_pairs) / len(valid_pairs)
    else:
        monotonicity = float("nan")

    # t-stat on spread
    if len(d1_vals) > 1 and len(d10_vals) > 1:
        t_stat, _ = stats.ttest_ind(d10_vals, d1_vals)
    else:
        t_stat = float("nan")

    return decile_means, float(spread), float(monotonicity), float(t_stat)


def _validate_score(col: str, label: str, df: pl.DataFrame) -> ScoreResult:
    scores_np = df[col].to_numpy().astype(float)
    n_obs = int((~np.isnan(scores_np)).sum())

    horizon_results = []
    for h in HORIZONS:
        fwd_col = f"fwd_{HORIZON_LABELS[h]}"
        fwd_np  = df[fwd_col].to_numpy().astype(float)

        ic, ic_p  = _ic_for_col(scores_np, fwd_np)
        decile_means, spread, mono, t = _decile_analysis(scores_np, fwd_np)

        horizon_results.append(HorizonResult(
            horizon=HORIZON_LABELS[h],
            ic=round(ic, 4),
            ic_pvalue=round(ic_p, 4),
            decile_means=[round(v, 4) if not np.isnan(v) else None for v in decile_means],
            spread=round(spread, 4),
            monotonicity=round(mono, 4),
            t_stat=round(t, 3),
        ))

        log.info(
            "  IC  %-20s  fwd_%s  IC=%.3f (p=%.3f)  spread=%.2f%%  mono=%.0f%%  t=%.2f",
            col, HORIZON_LABELS[h], ic, ic_p, spread, mono * 100, t,
        )

    return ScoreResult(score_col=col, label=label, n_obs=n_obs, horizons=horizon_results)


def run_all() -> list[ScoreResult]:
    """Load data once, validate all score columns in parallel."""
    log.info("forward_returns: loading joined dataset...")
    df = _load_base()
    log.info("forward_returns: %d rows loaded", len(df))

    with ThreadPoolExecutor(max_workers=len(SCORE_COLS)) as pool:
        futures = {
            col: pool.submit(_validate_score, col, label, df)
            for col, label in SCORE_COLS.items()
            if col in df.columns
        }
        return [f.result() for f in futures.values()]
