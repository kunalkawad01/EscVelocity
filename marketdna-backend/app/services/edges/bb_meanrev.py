"""
Edge: bb_meanrev — cross-sectional short-term mean reversion (Bollinger z-score).

Score = NEGATIVE 20-day z-score:  -(close - SMA20) / STD20
Higher score = more oversold = buy side (mean reversion buys panic). The bottom decile
is the most overbought, so the decile spread measures oversold-minus-overbought — the
canonical reversal premium. Mirrors the quant_strategies mean-reversion module's z-score.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

import numpy as np
import pandas as pd

from app.services.edges.base import EdgeMeasurement
from app.services.edges.ranking import fetch_close_pivot, measure_ranking_edge

KEY = "bb_meanrev"
LABEL = "Mean Reversion (BB z-score)"
LOOKBACK_BARS = 20


def _score(px: np.ndarray, f: int) -> np.ndarray:
    win = px[f - LOOKBACK_BARS + 1: f + 1]                 # trailing 20 bars incl. today
    with np.errstate(invalid="ignore"):
        mean = np.nanmean(win, axis=0)
        std = np.nanstd(win, axis=0, ddof=1)
        n_obs = np.isfinite(win).sum(axis=0)
        z = (px[f] - mean) / std
        return np.where((n_obs >= LOOKBACK_BARS) & np.isfinite(z) & (std > 0), -z, np.nan)


def _measure_from_pivot(pivot: pd.DataFrame, window_start: date) -> Optional[EdgeMeasurement]:
    return measure_ranking_edge(pivot, window_start, key=KEY, score_fn=_score,
                                lookback_bars=LOOKBACK_BARS,
                                extras={"score": "-z20 (oversold buys)"})


def measure(window_start: date, window_end_cap: date, universe: str) -> Optional[EdgeMeasurement]:
    pivot = fetch_close_pivot(window_start, window_end_cap, lookback_days=60)
    if pivot is None:
        return None
    return _measure_from_pivot(pivot, window_start)
