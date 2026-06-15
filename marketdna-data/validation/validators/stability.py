"""Rolling IC stability analysis.

For each score column, computes a 12-month rolling Spearman IC against
5d and 20d forward returns. Output:
  - rolling_ic_mean: mean IC over all windows
  - rolling_ic_std: std dev of IC
  - pct_positive: fraction of windows with IC > 0
  - pct_sig: fraction of windows with |IC| > 0.05 (economically meaningful)
  - worst_window: date of lowest IC (identifies regime where signal breaks)
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import NamedTuple

import numpy as np
import polars as pl
from scipy import stats

log = logging.getLogger(__name__)

ROLLING_MONTHS = 12
SCORE_COLS = ["regime_score", "rs_score", "recovery_score", "efficiency_score", "stock_dna_score"]
HORIZONS   = [5, 20]


class StabilityResult(NamedTuple):
    score_col: str
    horizon: str
    n_windows: int
    ic_mean: float
    ic_std: float
    pct_positive: float
    pct_sig: float
    worst_window: str | None
    best_window: str | None


def _rolling_ic(df: pl.DataFrame, score_col: str, fwd_col: str, horizon_label: str) -> StabilityResult:
    # Add year-month for grouping
    df2 = df.with_columns(
        pl.col("date").str.slice(0, 7).alias("ym")
    ).filter(pl.col(score_col).is_not_null() & pl.col(fwd_col).is_not_null())

    months = sorted(df2["ym"].unique().to_list())
    if len(months) < ROLLING_MONTHS + 1:
        return StabilityResult(score_col, horizon_label, 0, float("nan"), float("nan"),
                               float("nan"), float("nan"), None, None)

    ics: list[float] = []
    window_ends: list[str] = []

    for end_idx in range(ROLLING_MONTHS - 1, len(months)):
        window_months = months[end_idx - ROLLING_MONTHS + 1: end_idx + 1]
        window_df = df2.filter(pl.col("ym").is_in(window_months))

        sc = window_df[score_col].to_numpy().astype(float)
        fw = window_df[fwd_col].to_numpy().astype(float)

        mask = ~(np.isnan(sc) | np.isnan(fw))
        if mask.sum() < 30:
            continue

        r, _ = stats.spearmanr(sc[mask], fw[mask])
        ics.append(float(r))
        window_ends.append(months[end_idx])

    if not ics:
        return StabilityResult(score_col, horizon_label, 0, float("nan"), float("nan"),
                               float("nan"), float("nan"), None, None)

    ics_arr = np.array(ics)
    worst_idx = int(np.argmin(ics_arr))
    best_idx  = int(np.argmax(ics_arr))

    result = StabilityResult(
        score_col=score_col,
        horizon=horizon_label,
        n_windows=len(ics),
        ic_mean=round(float(ics_arr.mean()), 4),
        ic_std=round(float(ics_arr.std()), 4),
        pct_positive=round(float((ics_arr > 0).mean()), 4),
        pct_sig=round(float((np.abs(ics_arr) > 0.05).mean()), 4),
        worst_window=window_ends[worst_idx],
        best_window=window_ends[best_idx],
    )

    log.info(
        "  stability %-20s fwd_%s  mean_IC=%.3f  std=%.3f  pos=%.0f%%  sig=%.0f%%",
        score_col, horizon_label,
        result.ic_mean, result.ic_std, result.pct_positive * 100, result.pct_sig * 100,
    )
    return result


def run_all(df: pl.DataFrame) -> list[StabilityResult]:
    """Compute rolling IC stability for all score cols × horizons in parallel.

    df must contain score cols + fwd_5d + fwd_20d columns (pass from forward_returns._load_base()).
    """
    tasks = [
        (col, f"fwd_{h}d", f"{h}d")
        for col in SCORE_COLS
        if col in df.columns
        for h in HORIZONS
    ]
    with ThreadPoolExecutor(max_workers=min(8, len(tasks))) as pool:
        futures = [pool.submit(_rolling_ic, df, col, fwd_col, hlabel)
                   for col, fwd_col, hlabel in tasks]
        return [f.result() for f in futures]
