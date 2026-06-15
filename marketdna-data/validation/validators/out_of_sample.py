"""In-sample vs out-of-sample IC comparison.

Split: IS = 2020-01-01 to 2023-12-31, OOS = 2024-01-01 onwards.
For each score column, compare IC (5d and 20d) between periods.

Good signal: OOS IC >= 50% of IS IC.
Weak signal: OOS IC < 30% of IS IC — possible overfitting or regime change.
"""
from __future__ import annotations

import logging
from typing import NamedTuple

import numpy as np
import polars as pl
from scipy import stats

log = logging.getLogger(__name__)

SCORE_COLS = ["regime_score", "rs_score", "recovery_score", "efficiency_score", "stock_dna_score"]
IS_END     = "2023-12-31"
OOS_START  = "2024-01-01"


class OOSResult(NamedTuple):
    score_col: str
    horizon: str
    is_ic: float
    oos_ic: float
    retention: float   # oos_ic / is_ic — 1.0 = perfect retention
    passed: bool       # oos_ic >= 50% of is_ic (same sign and magnitude)


def _ic(scores: np.ndarray, fwd: np.ndarray) -> float:
    mask = ~(np.isnan(scores) | np.isnan(fwd))
    if mask.sum() < 30:
        return float("nan")
    r, _ = stats.spearmanr(scores[mask], fwd[mask])
    return float(r)


def run_all(df: pl.DataFrame) -> list[OOSResult]:
    """df: joined dataset from forward_returns._load_base() with date column."""
    results: list[OOSResult] = []

    is_df  = df.filter(pl.col("date") <= IS_END)
    oos_df = df.filter(pl.col("date") >= OOS_START)

    if is_df.is_empty() or oos_df.is_empty():
        log.warning("  oos: insufficient data for IS/OOS split")
        return results

    for col in SCORE_COLS:
        if col not in df.columns:
            continue
        for horizon, fwd_col in [(5, "fwd_5d"), (20, "fwd_20d")]:
            hlabel = f"{horizon}d"
            if fwd_col not in df.columns:
                continue

            is_ic  = _ic(is_df[col].to_numpy().astype(float),
                         is_df[fwd_col].to_numpy().astype(float))
            oos_ic = _ic(oos_df[col].to_numpy().astype(float),
                         oos_df[fwd_col].to_numpy().astype(float))

            if np.isnan(is_ic) or is_ic == 0:
                retention = float("nan")
                passed = False
            else:
                retention = oos_ic / is_ic
                # Pass: OOS IC is same sign and at least 50% magnitude
                passed = (oos_ic * is_ic > 0) and (abs(oos_ic) >= 0.5 * abs(is_ic))

            log.info(
                "  oos %-20s fwd_%s  IS_IC=%.3f  OOS_IC=%.3f  retention=%.0f%%  %s",
                col, hlabel, is_ic, oos_ic,
                retention * 100 if not np.isnan(retention) else float("nan"),
                "PASS" if passed else "WEAK",
            )

            results.append(OOSResult(
                score_col=col,
                horizon=hlabel,
                is_ic=round(is_ic, 4),
                oos_ic=round(oos_ic, 4),
                retention=round(retention, 4) if not np.isnan(retention) else None,
                passed=passed,
            ))

    return results
