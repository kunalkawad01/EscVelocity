"""Data-quality checks for each feature parquet.

Checks: no nulls in score cols, score range 0-100, no duplicate keys,
row-count plausibility, label membership.
"""
from __future__ import annotations

import logging
from pathlib import Path

import polars as pl

log = logging.getLogger(__name__)

FEATURES_DIR = Path("data_lake/features")

# (parquet_stem, key_cols, score_cols, label_col, valid_labels)
_SPEC: list[tuple] = [
    ("sma_regime",          ["symbol", "date"], ["price_score", "alignment_score", "slope_score", "regime_score"],
     "regime_label", {"Strong Bull", "Moderate Bull", "Neutral", "Moderate Bear", "Strong Bear"}),
    ("drawdown_recovery",   ["symbol", "date"], ["recovery_score"],
     None, None),
    ("relative_strength",   ["symbol", "date"], ["rs_score"],
     None, None),
    ("returns_vol",         ["symbol", "date"], [],
     None, None),
    ("technical_indicators",["symbol", "date"], ["rsi_14"],
     None, None),
    ("zscore",              ["symbol", "date"], [],
     None, None),
    ("breadth",             ["date"],            ["breadth_score", "nifty50_breadth_score"],
     "breadth_label", {"Broad Participation", "Moderate Breadth", "Narrow Breadth", "Poor Breadth"}),
    ("markov_regimes",      ["symbol", "month"], [],
     "regime", {"Strong Uptrend", "Volatile Bull", "Sideways Quiet",
                "Sideways Volatile", "Steady Bear", "Volatile Bear"}),
    ("markov_forecast",     ["symbol"],          ["dominant_prob"],
     "dominant_regime", {"Strong Uptrend", "Volatile Bull", "Sideways Quiet",
                         "Sideways Volatile", "Steady Bear", "Volatile Bear"}),
    ("stock_dna",           ["symbol", "date"], ["regime_score", "rs_score", "recovery_score",
                                                  "efficiency_score", "stock_dna_score"],
     "stock_dna_label", {"Tier 1", "Tier 2", "Tier 3", "Avoid"}),
    ("market_dna",          ["date"],            ["breadth_score", "avg_regime_score",
                                                   "stress_score", "leadership_score", "market_dna_score"],
     "market_dna_label", {"Expansion", "Recovery", "Contraction", "Recession"}),
]


def _check_one(stem: str, key_cols: list[str], score_cols: list[str],
               label_col: str | None, valid_labels: set | None) -> dict:
    path = FEATURES_DIR / f"{stem}.parquet"
    result: dict = {"feature": stem, "passed": True, "issues": [], "rows": 0, "symbols": 0}

    if not path.exists():
        result["passed"] = False
        result["issues"].append("parquet not found")
        return result

    df = pl.read_parquet(path)
    result["rows"] = len(df)
    if "symbol" in df.columns:
        result["symbols"] = df["symbol"].n_unique()

    # Null check on score cols
    for col in score_cols:
        if col not in df.columns:
            result["issues"].append(f"missing column: {col}")
            result["passed"] = False
            continue
        n_null = df[col].null_count()
        if n_null > 0:
            pct = n_null / len(df) * 100
            result["issues"].append(f"{col}: {n_null} nulls ({pct:.1f}%)")
            result["passed"] = False

    # Score range 0-100 for columns that should be bounded
    bounded_keywords = {"score", "rsi"}
    for col in score_cols:
        if not any(kw in col for kw in bounded_keywords):
            continue
        if col not in df.columns:
            continue
        s = df[col].drop_nulls()
        if s.is_empty():
            continue
        lo, hi = float(s.min()), float(s.max())
        if lo < -0.01 or hi > 100.01:
            result["issues"].append(f"{col}: range [{lo:.2f}, {hi:.2f}] outside [0, 100]")
            result["passed"] = False

    # Duplicate key check
    n_dupes = len(df) - df.select(key_cols).n_unique()
    if n_dupes > 0:
        result["issues"].append(f"duplicate keys: {n_dupes}")
        result["passed"] = False

    # Label membership
    if label_col and valid_labels and label_col in df.columns:
        bad_labels = set(df[label_col].unique().to_list()) - valid_labels
        if bad_labels:
            result["issues"].append(f"unexpected labels: {bad_labels}")
            result["passed"] = False

    # Probability rows sum to 1 (markov_forecast)
    prob_cols = [c for c in df.columns if c.startswith("p_")]
    if prob_cols:
        row_sums = df.select(prob_cols).sum_horizontal()
        bad_rows = int(((row_sums - 1.0).abs() > 0.01).sum())
        if bad_rows > 0:
            result["issues"].append(f"prob rows not summing to 1: {bad_rows}")
            result["passed"] = False

    if result["passed"]:
        log.info("  quality %-26s OK   (%d rows)", stem, result["rows"])
    else:
        log.warning("  quality %-26s FAIL %s", stem, "; ".join(result["issues"]))

    return result


def run_all() -> list[dict]:
    """Run quality checks on all 11 feature parquets. Returns list of result dicts."""
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [
            pool.submit(_check_one, stem, keys, scores, lbl, valid)
            for stem, keys, scores, lbl, valid in _SPEC
        ]
        return [f.result() for f in futures]
