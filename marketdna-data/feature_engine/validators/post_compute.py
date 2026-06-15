"""Post-compute validation for feature DataFrames."""
import logging
from typing import Any

import polars as pl

log = logging.getLogger(__name__)


def validate(name: str, df: pl.DataFrame, key_cols: list[str]) -> list[str]:
    """Run standard quality checks on a computed feature DataFrame.

    Returns list of warning strings (empty means clean).
    """
    warnings: list[str] = []

    if df.is_empty():
        warnings.append(f"{name}: DataFrame is empty")
        return warnings

    # 1. No nulls in score columns
    score_cols = [c for c in df.columns if c.endswith("_score")]
    for col in score_cols:
        null_count = df[col].null_count()
        if null_count > 0:
            warnings.append(f"{name}: {col} has {null_count} nulls")

    # 2. Score columns must be in [0, 100]
    for col in score_cols:
        series = df[col].drop_nulls()
        if len(series) == 0:
            continue
        lo = series.min()
        hi = series.max()
        if lo < -0.01 or hi > 100.01:
            warnings.append(f"{name}: {col} out of range [{lo:.2f}, {hi:.2f}]")

    # 3. No duplicate rows on key_cols
    total = len(df)
    unique = df.select(key_cols).n_unique()
    if unique < total:
        warnings.append(f"{name}: {total - unique} duplicate rows on {key_cols}")

    # 4. Probability columns sum to ~1.0 per row
    prob_cols = [c for c in df.columns if c.startswith("p_") and "prob" not in c]
    if len(prob_cols) == 6:
        row_sums = df.select(prob_cols).sum_horizontal()
        bad = (row_sums - 1.0).abs().gt(0.01).sum()
        if bad > 0:
            warnings.append(f"{name}: {bad} rows where prob columns do not sum to 1.0")

    for w in warnings:
        log.warning(w)

    return warnings
