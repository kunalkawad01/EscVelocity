"""
Edge: momentum_12_1 — classic cross-sectional 12-1 skip-one-month momentum.

Score (mirrors quant_strategies_service exactly):
    close[t-21] / close[t-252] - 1     (12m ago -> 1m ago, skip the reversal-prone month)

Higher score = stronger momentum = buy side. Protocol lives in ranking.py.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

import numpy as np
import pandas as pd

from app.services.edges.base import EdgeMeasurement
from app.services.edges.ranking import fetch_close_pivot, measure_ranking_edge

KEY = "momentum_12_1"
LABEL = "Momentum 12-1"
LOOKBACK_BARS = 252
SKIP_BARS = 21


def _score(px: np.ndarray, f: int) -> np.ndarray:
    c_1m, c_12m = px[f - SKIP_BARS], px[f - LOOKBACK_BARS]
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(np.isfinite(c_1m) & np.isfinite(c_12m) & (c_12m > 0),
                        c_1m / c_12m - 1.0, np.nan)


def _measure_from_pivot(pivot: pd.DataFrame, window_start: date) -> Optional[EdgeMeasurement]:
    return measure_ranking_edge(pivot, window_start, key=KEY, score_fn=_score,
                                lookback_bars=LOOKBACK_BARS,
                                extras={"lookback": "12-1"})


def measure(window_start: date, window_end_cap: date, universe: str) -> Optional[EdgeMeasurement]:
    pivot = fetch_close_pivot(window_start, window_end_cap, lookback_days=400)
    if pivot is None:
        return None
    return _measure_from_pivot(pivot, window_start)
