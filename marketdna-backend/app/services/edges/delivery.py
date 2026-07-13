"""
Edge: delivery_accumulation — the Delivery page's Signal 1, measured longitudinally.

Signal definition (mirrors delivery_service exactly):
    volume > 2 x SMA20(volume)  AND  delivery_pct >= 65  AND  close > open

Measurement protocol per window:
  * For every symbol with delivery data, find event bars matching the signal inside
    [window_start, window_end_cap], keeping only events with a full 21-bar forward
    window (truncation rule).
  * Score each event with its 21-day forward return MINUS the equal-weight forward
    return of the delivery universe from the same bar (market-adjusted excess).
  * Aggregate: edge_ann_pct = mean(excess) x 12; hit_rate = % events with positive
    excess; CI = bootstrap over per-event excesses. Decile spread does not apply
    (event edge, not a ranking edge) and is stored NULL.

Delivery history starts 2025-01 and covers ~50 NIFTY symbols, so early windows are
partial — flagged in extras.partial_window instead of silently pretending otherwise.
A reading requires >= MIN_EVENTS scored events.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from app.services.edges.base import FWD_BARS, EdgeMeasurement, bootstrap_ci

log = logging.getLogger(__name__)

KEY = "delivery_accumulation"
KEY_DIST = "delivery_distribution"
LABEL = "Delivery Accumulation"
LABEL_DIST = "Delivery Distribution"
VOL_AVG_WIN = 20               # delivery_service._VOL_AVG_WIN
VOL_SURGE = 2.0                # volume > 2x average
DEL_MIN = 65.0                 # delivery % threshold
MIN_EVENTS = 15                # below this, the window is skipped


def _measure_from_frames(prices: pd.DataFrame, delivery: pd.DataFrame,
                         window_start: date, *, bearish: bool = False) -> Optional[EdgeMeasurement]:
    """Pure core.

    prices:   columns [symbol, d(datetime), open, close, volume], all delivery symbols
    delivery: columns [symbol, d(datetime), delivery_pct]
    bearish:  False -> Accumulation (close > open, long); True -> Distribution
              (close < open, short). Bearish excess is SIGN-ADJUSTED (universe - fwd)
              so positive always means "the trade worked" (CLAUDE.md lesson).
    """
    close_pv = prices.pivot_table(index="d", columns="symbol", values="close", aggfunc="last").sort_index()
    open_pv = prices.pivot_table(index="d", columns="symbol", values="open", aggfunc="last").reindex_like(close_pv)
    vol_pv = prices.pivot_table(index="d", columns="symbol", values="volume", aggfunc="last").reindex_like(close_pv)
    del_pv = delivery.pivot_table(index="d", columns="symbol", values="delivery_pct", aggfunc="last") \
                     .reindex(index=close_pv.index, columns=close_pv.columns)

    n = len(close_pv)
    if n <= FWD_BARS + VOL_AVG_WIN:
        return None
    dates = close_pv.index
    c = close_pv.to_numpy(float)
    o = open_pv.to_numpy(float)
    v = vol_pv.to_numpy(float)
    dl = del_pv.to_numpy(float)

    vol_avg = pd.DataFrame(v).rolling(VOL_AVG_WIN).mean().to_numpy()
    fwd = np.full_like(c, np.nan)
    fwd[:-FWD_BARS] = c[FWD_BARS:] / c[:-FWD_BARS] - 1.0
    # Equal-weight universe baseline. The last FWD_BARS rows are all-NaN by construction
    # (truncation) — suppress numpy's empty-slice warning; those rows are never scored.
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        uni_fwd = np.nanmean(fwd, axis=1)

    in_window = np.array([d.date() >= window_start for d in dates])
    scorable = np.zeros(n, dtype=bool)
    scorable[:n - FWD_BARS] = True                         # truncation: full forward window

    candle = (c < o) if bearish else (c > o)
    signal = (
        np.isfinite(dl) & np.isfinite(vol_avg) & (vol_avg > 0)
        & (v > VOL_SURGE * vol_avg) & (dl >= DEL_MIN)
        & np.isfinite(c) & np.isfinite(o) & candle
        & np.isfinite(fwd)
    )
    signal &= in_window[:, None] & scorable[:, None]

    ev_rows, ev_cols = np.where(signal)
    if len(ev_rows) < MIN_EVENTS:
        return None
    sign = -1.0 if bearish else 1.0                        # positive = trade worked
    excess = sign * (fwd[ev_rows, ev_cols] - uni_fwd[ev_rows])
    excess = excess[np.isfinite(excess)]
    if len(excess) < MIN_EVENTS:
        return None

    ci_lo, ci_hi = bootstrap_ci(excess * 100.0)
    ev_dates = sorted(dates[i].date() for i in set(ev_rows))
    # Partial window: delivery data does not reach back to window_start
    first_del = delivery["d"].min().date() if len(delivery) else None
    partial = bool(first_del and first_del > window_start + timedelta(days=45))
    return EdgeMeasurement(
        edge_key=KEY_DIST if bearish else KEY,
        edge_ann_pct=round(float(excess.mean()) * 12 * 100, 3),
        hit_rate=round(float((excess > 0).mean()) * 100, 1),
        decile_spread=None,
        n_signals=int(len(excess)),
        ci_low=round(ci_lo, 3) if ci_lo is not None else None,
        ci_high=round(ci_hi, 3) if ci_hi is not None else None,
        window_start=str(ev_dates[0]),
        window_end=str(ev_dates[-1]),
        extras={
            "signal": f"vol>2x20d & delivery>=65% & close{'<' if bearish else '>'}open",
            "direction": "short (sign-adjusted)" if bearish else "long",
            "baseline": "equal-weight delivery universe 21d fwd",
            "n_symbols": int(close_pv.shape[1]),
            "partial_window": partial,
            "delivery_data_from": str(first_del) if first_del else None,
            "fwd_bars": FWD_BARS,
        },
    )


def _fetch_frames(window_start: date, window_end_cap: date):
    """(prices, delivery) frames for the delivery universe, or (None, None)."""
    from app.services.duckdb_client import get_connection
    fetch_from = window_start - timedelta(days=45)
    con = get_connection()
    try:
        drows = con.execute(
            """
            SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d, delivery_pct
            FROM delivery_data
            WHERE CAST(date AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
              AND delivery_pct IS NOT NULL
            """, [str(fetch_from), str(window_end_cap)]).fetchall()
    except Exception as exc:                               # view absent (no delivery parquet)
        log.warning("delivery edge: delivery_data unavailable (%s)", exc)
        return None, None
    if not drows:
        return None, None
    delivery = pd.DataFrame(drows, columns=["symbol", "d", "delivery_pct"])
    delivery["d"] = pd.to_datetime(delivery["d"])
    syms = sorted(delivery["symbol"].unique())
    inlist = ",".join("'" + s.replace("'", "''") + "'" for s in syms)
    prows = con.execute(
        f"""
        SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d, open, close, volume
        FROM equities_prices
        WHERE symbol IN ({inlist})
          AND CAST(date AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
        """, [str(fetch_from), str(window_end_cap)]).fetchall()
    if not prows:
        return None, None
    prices = pd.DataFrame(prows, columns=["symbol", "d", "open", "close", "volume"])
    prices["d"] = pd.to_datetime(prices["d"])
    return prices, delivery


def measure(window_start: date, window_end_cap: date, universe: str) -> Optional[EdgeMeasurement]:
    """Accumulation (bullish) — vol surge + high delivery + up candle."""
    prices, delivery = _fetch_frames(window_start, window_end_cap)
    if prices is None:
        return None
    return _measure_from_frames(prices, delivery, window_start, bearish=False)


def measure_distribution(window_start: date, window_end_cap: date,
                         universe: str) -> Optional[EdgeMeasurement]:
    """Distribution (bearish) — vol surge + high delivery + down candle, sign-adjusted."""
    prices, delivery = _fetch_frames(window_start, window_end_cap)
    if prices is None:
        return None
    return _measure_from_frames(prices, delivery, window_start, bearish=True)
