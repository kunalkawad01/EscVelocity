"""
Edge: low_vol — the low-volatility anomaly, cross-sectional.

Score = NEGATIVE trailing 60-day daily-return volatility. Higher score = calmer stock =
buy side. The decile spread is calm-minus-wild forward return — positive when boring
stocks earn more than they "should" (the classic anomaly the Sleep-Well portfolio rides).
"""
from __future__ import annotations

from datetime import date
from typing import Optional

import numpy as np
import pandas as pd

from app.services.edges.base import EdgeMeasurement
from app.services.edges.ranking import fetch_close_pivot, measure_ranking_edge

KEY = "low_vol"
LABEL = "Low Volatility"
LOOKBACK_BARS = 61                     # 60 daily returns need 61 closes


def _score(px: np.ndarray, f: int) -> np.ndarray:
    win = px[f - LOOKBACK_BARS + 1: f + 1]
    with np.errstate(divide="ignore", invalid="ignore"):
        rets = win[1:] / win[:-1] - 1.0
        vol = np.nanstd(rets, axis=0, ddof=1)
        n_obs = np.isfinite(rets).sum(axis=0)
        return np.where((n_obs >= LOOKBACK_BARS - 5) & np.isfinite(vol) & (vol > 0),
                        -vol, np.nan)


def _measure_from_pivot(pivot: pd.DataFrame, window_start: date) -> Optional[EdgeMeasurement]:
    return measure_ranking_edge(pivot, window_start, key=KEY, score_fn=_score,
                                lookback_bars=LOOKBACK_BARS,
                                extras={"score": "-std(60d daily returns) (calm buys)"})


def measure(window_start: date, window_end_cap: date, universe: str) -> Optional[EdgeMeasurement]:
    pivot = fetch_close_pivot(window_start, window_end_cap, lookback_days=120)
    if pivot is None:
        return None
    return _measure_from_pivot(pivot, window_start)
