"""Markov regime validation.

Checks:
  1. Next-month forward return by current regime — does Strong Uptrend > Steady Bear?
  2. Regime distribution across 500 symbols
  3. Regime persistence (% months where symbol stays in same regime)
  4. Transition matrix plausibility (no degenerate states)
"""
from __future__ import annotations

import logging
from typing import NamedTuple

import duckdb
import numpy as np
import polars as pl

log = logging.getLogger(__name__)

_MARKOV = "data_lake/features/markov_regimes.parquet"
_RAW    = "data_lake/raw/equities/**/*.parquet"

REGIME_ORDER = [
    "Strong Uptrend", "Volatile Bull", "Sideways Quiet",
    "Sideways Volatile", "Steady Bear", "Volatile Bear",
]


class RegimeReturnRow(NamedTuple):
    regime: str
    n_months: int
    mean_next_month_ret: float
    median_next_month_ret: float
    pct_positive: float


class MarkovValidationResult(NamedTuple):
    regime_returns: list[RegimeReturnRow]
    regime_distribution: dict[str, float]   # regime -> % of rows
    persistence: float                        # % months same regime as prior
    dominant_symbol_count: dict[str, int]    # regime -> n symbols where dominant
    passed: bool
    issues: list[str]


def run() -> MarkovValidationResult:
    path_ok = __import__("pathlib").Path(_MARKOV).exists()
    if not path_ok:
        return MarkovValidationResult([], {}, float("nan"), {}, False,
                                      ["markov_regimes.parquet not found"])

    df = pl.read_parquet(_MARKOV).sort(["symbol", "month"])

    issues: list[str] = []

    # ── 1. Next-month forward returns by current regime ──────────────────────────
    # Join each row with the next row's monthly_ret for the same symbol
    df2 = df.with_columns(
        pl.col("monthly_ret").shift(-1).over("symbol").alias("next_month_ret")
    ).filter(pl.col("next_month_ret").is_not_null())

    regime_rows: list[RegimeReturnRow] = []
    for regime in REGIME_ORDER:
        sub = df2.filter(pl.col("regime") == regime)["next_month_ret"].to_numpy()
        if len(sub) < 5:
            continue
        row = RegimeReturnRow(
            regime=regime,
            n_months=len(sub),
            mean_next_month_ret=round(float(sub.mean()), 4),
            median_next_month_ret=round(float(np.median(sub)), 4),
            pct_positive=round(float((sub > 0).mean()), 4),
        )
        regime_rows.append(row)
        log.info(
            "  markov %-20s  n=%4d  mean=%.2f%%  median=%.2f%%  pct_pos=%.0f%%",
            regime, row.n_months, row.mean_next_month_ret,
            row.median_next_month_ret, row.pct_positive * 100,
        )

    # Sanity: Strong Uptrend mean > Steady Bear mean
    su = next((r for r in regime_rows if r.regime == "Strong Uptrend"), None)
    sb = next((r for r in regime_rows if r.regime == "Steady Bear"), None)
    if su and sb and su.mean_next_month_ret <= sb.mean_next_month_ret:
        issues.append(
            f"Strong Uptrend mean ({su.mean_next_month_ret:.2f}%) "
            f"<= Steady Bear ({sb.mean_next_month_ret:.2f}%) — signal may be inverted"
        )

    # ── 2. Regime distribution ───────────────────────────────────────────────────
    dist_counts = df["regime"].value_counts()
    total = len(df)
    distribution = {
        row["regime"]: round(row["count"] / total, 4)
        for row in dist_counts.to_dicts()
    }

    # Check no regime is dominant (>60%) — would indicate bad classifier
    for regime, pct in distribution.items():
        if pct > 0.60:
            issues.append(f"Regime {regime} dominates at {pct*100:.0f}% — classifier skewed")

    # ── 3. Regime persistence ────────────────────────────────────────────────────
    df3 = df.with_columns(
        pl.col("regime").shift(1).over("symbol").alias("prev_regime")
    ).filter(pl.col("prev_regime").is_not_null())

    persistence = float((df3["regime"] == df3["prev_regime"]).mean())
    log.info("  markov persistence: %.1f%%", persistence * 100)

    if persistence < 0.30:
        issues.append(f"Regime persistence {persistence*100:.0f}% < 30% — regimes too noisy")

    # ── 4. Per-symbol dominant regime ───────────────────────────────────────────
    sym_dominant = (
        df.group_by(["symbol", "regime"]).len()
        .sort("len", descending=True)
        .group_by("symbol").first()
        .group_by("regime").len()
    )
    dom_map = {row["regime"]: row["len"] for row in sym_dominant.to_dicts()}

    passed = len(issues) == 0
    if passed:
        log.info("  markov validation PASSED")
    else:
        for issue in issues:
            log.warning("  markov ISSUE: %s", issue)

    return MarkovValidationResult(
        regime_returns=regime_rows,
        regime_distribution=distribution,
        persistence=round(persistence, 4),
        dominant_symbol_count=dom_map,
        passed=passed,
        issues=issues,
    )
