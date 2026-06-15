"""Per-symbol next-month regime forecast + options strategy. Reads markov_regimes.parquet."""
import logging
import time
from datetime import date

import numpy as np
import polars as pl

from feature_engine.features._base import read_feature
from feature_engine.writers.feature_writer import write_feature

log = logging.getLogger(__name__)
NAME = "markov_forecast"

REGIMES = [
    "Strong Uptrend", "Volatile Bull", "Sideways Quiet",
    "Sideways Volatile", "Steady Bear", "Volatile Bear",
]
REGIME_IDX: dict[str, int] = {r: i for i, r in enumerate(REGIMES)}
REGIME_PROB_COLS = [
    "p_strong_uptrend", "p_volatile_bull", "p_sideways_quiet",
    "p_sideways_volatile", "p_steady_bear", "p_volatile_bear",
]

_PRIOR = np.array([0.20, 0.08, 0.25, 0.10, 0.25, 0.12], dtype=float)
_ALPHA = 0.20

_STRATEGY_MAP: dict[str, dict] = {
    "Strong Uptrend":   {"primary": "Bull Call Spread",  "iv_action": "Sell"},
    "Volatile Bull":    {"primary": "Long Call",          "iv_action": "Buy"},
    "Sideways Quiet":   {"primary": "Iron Condor",        "iv_action": "Sell"},
    "Sideways Volatile":{"primary": "Long Straddle",      "iv_action": "Buy"},
    "Steady Bear":      {"primary": "Bear Put Spread",    "iv_action": "Sell"},
    "Volatile Bear":    {"primary": "Long Put",           "iv_action": "Buy"},
}


def _build_matrix(labels: list[str]) -> np.ndarray:
    """Return 6x6 Bayesian-blended transition probability matrix."""
    counts = np.zeros((6, 6), dtype=float)
    for i in range(len(labels) - 1):
        src = REGIME_IDX.get(labels[i], -1)
        dst = REGIME_IDX.get(labels[i + 1], -1)
        if src >= 0 and dst >= 0:
            counts[src, dst] += 1
    row_sums = counts.sum(axis=1, keepdims=True)
    observed = np.where(row_sums > 0, counts / row_sums, 0.0)
    prior_mat = np.tile(_PRIOR, (6, 1))
    blended   = (1 - _ALPHA) * observed + _ALPHA * prior_mat
    zero_rows = (row_sums.flatten() == 0)
    blended[zero_rows] = _PRIOR
    return blended


def compute(incremental: bool = False) -> pl.DataFrame:
    """Compute markov_forecast from markov_regimes.parquet. Always full recompute."""
    t0 = time.perf_counter()

    regimes_df = read_feature("markov_regimes")
    if regimes_df is None or regimes_df.is_empty():
        raise RuntimeError("markov_regimes.parquet not found — run markov_regimes first")

    today = date.today().isoformat()
    records: list[dict] = []

    for sym_df in regimes_df.partition_by("symbol", maintain_order=True):
        symbol = sym_df["symbol"][0]
        labels = sym_df.sort("month")["regime"].to_list()
        if len(labels) < 2:
            continue

        blended = _build_matrix(labels)
        current_regime = labels[-1]
        curr_idx = REGIME_IDX.get(current_regime, 0)

        state_vec = np.zeros(6)
        state_vec[curr_idx] = 1.0
        next_probs = state_vec @ blended

        sorted_probs = sorted(enumerate(next_probs), key=lambda x: x[1], reverse=True)
        dominant_idx  = sorted_probs[0][0]
        dominant_regime = REGIMES[dominant_idx]
        dominant_prob   = float(sorted_probs[0][1])

        tail_risk_regime: str | None = None
        tail_risk_prob: float | None = None
        if len(sorted_probs) > 1 and sorted_probs[1][1] >= 0.15:
            tail_risk_regime = REGIMES[sorted_probs[1][0]]
            tail_risk_prob   = float(sorted_probs[1][1])

        strat = _STRATEGY_MAP[dominant_regime]

        row: dict = {
            "symbol":         symbol,
            "current_regime": current_regime,
            "dominant_regime": dominant_regime,
            "dominant_prob":  round(dominant_prob, 4),
            "tail_risk_regime": tail_risk_regime,
            "tail_risk_prob":   round(tail_risk_prob, 4) if tail_risk_prob else None,
            "primary_strategy": strat["primary"],
            "iv_action":      strat["iv_action"],
            "computed_date":  today,
        }
        for col, prob in zip(REGIME_PROB_COLS, next_probs):
            row[col] = round(float(prob), 4)

        records.append(row)

    df = pl.DataFrame(records, schema={
        "symbol":           pl.Utf8,
        "current_regime":   pl.Utf8,
        "p_strong_uptrend": pl.Float64,
        "p_volatile_bull":  pl.Float64,
        "p_sideways_quiet": pl.Float64,
        "p_sideways_volatile": pl.Float64,
        "p_steady_bear":    pl.Float64,
        "p_volatile_bear":  pl.Float64,
        "dominant_regime":  pl.Utf8,
        "dominant_prob":    pl.Float64,
        "tail_risk_regime": pl.Utf8,
        "tail_risk_prob":   pl.Float64,
        "primary_strategy": pl.Utf8,
        "iv_action":        pl.Utf8,
        "computed_date":    pl.Utf8,
    }).sort("symbol")

    log.info("%s: %d symbols in %.1fs", NAME, len(df), time.perf_counter() - t0)
    return df
