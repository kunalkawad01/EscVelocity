"""
Edge Decay Observatory — generic cross-sectional ranking-edge engine.

Any edge of the form "rank the universe by a score, buy the top decile" (momentum,
mean reversion, low volatility...) shares this measurement protocol:

  * Formation dates step every STEP_BARS backward from the last bar with a full
    FWD_BARS forward window (truncation rule) down to window_start.
  * At each formation date, `score_fn(px, f)` returns one score per symbol
    (NaN = symbol invalid at this date; HIGHER score = the side the strategy buys).
  * Top/bottom decile (>= MIN_DECILE names, >= MIN_UNIVERSE valid symbols) scored by
    the 21-day forward return.
  * Aggregation: edge_ann_pct = mean(top - universe) x 12; decile_spread =
    mean(top - bottom) per month; hit_rate = % dates with positive excess;
    CI = deterministic bootstrap over the per-date spreads.

Edges built on this engine differ ONLY in their score function and lookback — the
protocol, deciles, truncation and statistics are identical by construction, which is
what makes their decay curves comparable.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Callable, Optional

import numpy as np
import pandas as pd

from app.services.edges.base import FWD_BARS, EdgeMeasurement, bootstrap_ci

log = logging.getLogger(__name__)

STEP_BARS = 21                 # one formation per ~month (non-overlapping forward windows)
MIN_UNIVERSE = 50              # min valid symbols at a formation date
MIN_DECILE = 5                 # min names per decile
MIN_FORMATION_DATES = 20       # full 24m window yields ~23; below this -> skip window

ScoreFn = Callable[[np.ndarray, int], np.ndarray]   # (px[n_dates, n_syms], f) -> scores


def measure_ranking_edge(pivot: pd.DataFrame, window_start: date, *, key: str,
                         score_fn: ScoreFn, lookback_bars: int,
                         extras: Optional[dict] = None) -> Optional[EdgeMeasurement]:
    """Pure core: pivot = close prices, ascending DatetimeIndex x symbol columns."""
    px = pivot.to_numpy(dtype=float)
    dates = pivot.index
    n = len(dates)
    last_formation = n - 1 - FWD_BARS                     # truncation: full forward window
    if last_formation < lookback_bars:
        return None

    spreads, excesses, top_counts = [], [], []
    used_dates: list = []
    f = last_formation
    while f >= lookback_bars:
        if dates[f].date() < window_start:
            break
        c_now = px[f]
        c_fwd = px[f + FWD_BARS]
        scores = score_fn(px, f)
        valid = np.isfinite(scores) & np.isfinite(c_now) & (c_now > 0) & np.isfinite(c_fwd)
        n_valid = int(valid.sum())
        if n_valid >= MIN_UNIVERSE:
            k = max(n_valid // 10, MIN_DECILE)
            vidx = np.where(valid)[0]
            order = vidx[np.argsort(scores[vidx])]        # ascending score, valid only
            bot_idx, top_idx = order[:k], order[-k:]
            fwd = c_fwd / c_now - 1.0
            top_mean = float(fwd[top_idx].mean())
            bot_mean = float(fwd[bot_idx].mean())
            uni_mean = float(fwd[vidx].mean())
            spreads.append(top_mean - bot_mean)
            excesses.append(top_mean - uni_mean)
            top_counts.append(k)
            used_dates.append(dates[f].date())
        f -= STEP_BARS

    if len(used_dates) < MIN_FORMATION_DATES:
        return None
    used_dates.reverse()
    spreads_arr = np.array(spreads, dtype=float)
    excess_arr = np.array(excesses, dtype=float)
    ci_lo, ci_hi = bootstrap_ci(spreads_arr * 100.0)
    base_extras = {
        "n_formation_dates": len(used_dates),
        "step_bars": STEP_BARS, "fwd_bars": FWD_BARS,
        "universe_asof": "current",                       # known limitation: survivorship (v1)
    }
    if extras:
        base_extras.update(extras)
    return EdgeMeasurement(
        edge_key=key,
        edge_ann_pct=round(float(excess_arr.mean()) * 12 * 100, 3),
        hit_rate=round(float((excess_arr > 0).mean()) * 100, 1),
        decile_spread=round(float(spreads_arr.mean()) * 100, 3),
        n_signals=int(sum(top_counts)),
        ci_low=round(ci_lo, 3) if ci_lo is not None else None,
        ci_high=round(ci_hi, 3) if ci_hi is not None else None,
        window_start=str(used_dates[0]),
        window_end=str(used_dates[-1]),
        extras=base_extras,
    )


def fetch_close_pivot(window_start: date, window_end_cap: date,
                      lookback_days: int) -> Optional[pd.DataFrame]:
    """Bulk-fetch the close-price pivot for a window (+lookback buffer before it)."""
    from datetime import timedelta
    from app.services.duckdb_client import get_connection
    fetch_from = window_start - timedelta(days=lookback_days)
    con = get_connection()
    rows = con.execute(
        """
        SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d, close
        FROM equities_prices
        WHERE CAST(date AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
        """, [str(fetch_from), str(window_end_cap)]).fetchall()
    if not rows:
        return None
    df = pd.DataFrame(rows, columns=["symbol", "d", "close"])
    pivot = df.pivot_table(index="d", columns="symbol", values="close", aggfunc="last")
    pivot.index = pd.to_datetime(pivot.index)
    return pivot.sort_index()
