"""Edge Decay Observatory — core math, determinism, truncation, store idempotency."""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from app.services.edges import bb_meanrev, delivery, low_vol, momentum
from app.services.edges.base import FWD_BARS, bootstrap_ci

# ── synthetic worlds ──────────────────────────────────────────────────────────


def _momentum_world(n_days: int = 720, n_syms: int = 60) -> pd.DataFrame:
    """A universe where momentum PROVABLY works: each symbol has a constant daily
    drift, so past 12-1 winners keep outperforming. Deterministic (seeded noise)."""
    rng = np.random.RandomState(7)
    drifts = np.linspace(-0.0015, 0.0025, n_syms)          # persistent cross-section
    noise = rng.normal(0, 0.004, size=(n_days, n_syms))
    logp = np.cumsum(drifts[None, :] + noise, axis=0)
    px = 100.0 * np.exp(logp)
    idx = pd.bdate_range("2023-01-02", periods=n_days)
    return pd.DataFrame(px, index=idx, columns=[f"S{i:02d}" for i in range(n_syms)])


def _delivery_world():
    """5 symbols, 120 days. 20 'accumulation' event bars on S0; after each event S0
    rallies while the rest stay flat -> positive market-adjusted edge."""
    n, syms = 120, ["S0", "S1", "S2", "S3", "S4"]
    idx = pd.bdate_range("2025-01-01", periods=n)
    close = {s: np.full(n, 100.0) for s in syms}
    # S0 steps up 0.2% every bar after day 30 -> any event bar has positive fwd return
    close["S0"] = 100.0 * (1.002 ** np.arange(n))
    rows_p, rows_d = [], []
    # Events every 4 bars: sparse enough that the 5000-volume spikes don't inflate their
    # own SMA20 baseline past the 2x surge test. 19 events, all with a full fwd window.
    event_days = list(range(25, 99, 4))
    for s in syms:
        for i, d in enumerate(idx):
            vol = 1000.0
            dlv = 40.0
            op = close[s][i] * 0.999
            if s == "S0" and i in event_days:
                vol = 5000.0                                # > 2x SMA20
                dlv = 80.0                                  # >= 65
                op = close[s][i] * 0.99                     # close > open
            rows_p.append((s, d, op, close[s][i], vol))
            rows_d.append((s, d, dlv))
    prices = pd.DataFrame(rows_p, columns=["symbol", "d", "open", "close", "volume"])
    dlv = pd.DataFrame(rows_d, columns=["symbol", "d", "delivery_pct"])
    return prices, dlv


# ── momentum core ─────────────────────────────────────────────────────────────


def test_momentum_detects_planted_edge():
    pivot = _momentum_world()
    m = momentum._measure_from_pivot(pivot, window_start=pivot.index[260].date())
    assert m is not None
    assert m.decile_spread > 0, "persistent-drift world must show a positive spread"
    assert m.edge_ann_pct > 0
    assert m.hit_rate > 60
    assert m.n_signals > 0
    assert m.ci_low is not None and m.ci_low < m.decile_spread < m.ci_high


def test_momentum_deterministic():
    pivot = _momentum_world()
    ws = pivot.index[260].date()
    a = momentum._measure_from_pivot(pivot, ws)
    b = momentum._measure_from_pivot(pivot, ws)
    assert a == b, "same window in -> identical measurement out (Principle 3)"


def test_momentum_forward_truncation():
    """No formation date may sit within FWD_BARS of the last bar."""
    pivot = _momentum_world()
    m = momentum._measure_from_pivot(pivot, window_start=pivot.index[260].date())
    last_allowed = pivot.index[len(pivot) - 1 - FWD_BARS].date()
    assert date.fromisoformat(m.window_end) <= last_allowed


def test_momentum_skips_insufficient_window():
    pivot = _momentum_world(n_days=400)                     # too short for 20 formations
    assert momentum._measure_from_pivot(pivot, pivot.index[260].date()) is None


# ── mean reversion core ───────────────────────────────────────────────────────


def _meanrev_world(n_days: int = 720, n_syms: int = 60) -> pd.DataFrame:
    """A universe where mean reversion PROVABLY works: log-price is a strongly
    mean-reverting AR(1), so today's oversold names bounce over the next month."""
    rng = np.random.RandomState(11)
    x = np.zeros((n_days, n_syms))
    shocks = rng.normal(0, 0.02, size=(n_days, n_syms))
    for t in range(1, n_days):
        x[t] = 0.85 * x[t - 1] + shocks[t]                 # pulls back toward 0
    px = 100.0 * np.exp(x)
    idx = pd.bdate_range("2023-01-02", periods=n_days)
    return pd.DataFrame(px, index=idx, columns=[f"S{i:02d}" for i in range(n_syms)])


def test_bb_meanrev_detects_planted_edge():
    pivot = _meanrev_world()
    m = bb_meanrev._measure_from_pivot(pivot, window_start=pivot.index[100].date())
    assert m is not None
    assert m.decile_spread > 0, "AR(1) world: oversold must out-bounce overbought"
    assert m.edge_ann_pct > 0
    a = bb_meanrev._measure_from_pivot(pivot, pivot.index[100].date())
    assert a == m                                           # determinism


# ── low-vol core ──────────────────────────────────────────────────────────────


def test_low_vol_detects_planted_edge():
    """World where calm stocks have higher drift — the anomaly by construction."""
    rng = np.random.RandomState(13)
    n_days, n_syms = 720, 60
    vols = np.linspace(0.004, 0.03, n_syms)
    drifts = 0.0025 - 0.09 * vols                           # calm -> strongly positive drift
    noise = rng.normal(0, 1, size=(n_days, n_syms)) * vols[None, :]
    px = 100.0 * np.exp(np.cumsum(drifts[None, :] + noise, axis=0))
    pivot = pd.DataFrame(px, index=pd.bdate_range("2023-01-02", periods=n_days),
                         columns=[f"S{i:02d}" for i in range(n_syms)])
    m = low_vol._measure_from_pivot(pivot, window_start=pivot.index[100].date())
    assert m is not None
    assert m.decile_spread > 0, "calm-outearns-wild world must show a positive spread"
    assert m.edge_ann_pct > 0


# ── delivery core ─────────────────────────────────────────────────────────────


def test_delivery_detects_planted_edge():
    prices, dlv = _delivery_world()
    m = delivery._measure_from_frames(prices, dlv, window_start=date(2025, 1, 1))
    assert m is not None
    assert m.n_signals >= delivery.MIN_EVENTS
    assert m.edge_ann_pct > 0, "S0 rallies after every event -> positive excess"
    assert m.hit_rate > 60
    assert m.decile_spread is None                          # event edge: no deciles


def test_delivery_deterministic():
    prices, dlv = _delivery_world()
    a = delivery._measure_from_frames(prices, dlv, date(2025, 1, 1))
    b = delivery._measure_from_frames(prices, dlv, date(2025, 1, 1))
    assert a == b


def test_delivery_distribution_sign_adjusted():
    """Bearish twin: down-candle events on a FALLING stock -> positive (sign-adjusted)."""
    prices, dlv = _delivery_world()
    # Make S0 fall 0.2%/bar and flip event candles to close < open.
    n = 120
    fall = 100.0 * (0.998 ** np.arange(n))
    is_s0 = prices["symbol"] == "S0"
    order = prices.loc[is_s0].sort_values("d").index
    prices.loc[order, "close"] = fall
    prices.loc[order, "open"] = fall * 1.001                # close < open everywhere on S0
    m = delivery._measure_from_frames(prices, dlv, date(2025, 1, 1), bearish=True)
    assert m is not None
    assert m.edge_key == delivery.KEY_DIST
    assert m.edge_ann_pct > 0, "falling stock after bearish events must score positive"


def test_delivery_too_few_events_skips():
    prices, dlv = _delivery_world()
    dlv = dlv.copy()
    dlv["delivery_pct"] = 40.0                              # kill every event
    assert delivery._measure_from_frames(prices, dlv, date(2025, 1, 1)) is None


# ── bootstrap ─────────────────────────────────────────────────────────────────


def test_bootstrap_deterministic_and_sane():
    vals = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    a, b = bootstrap_ci(vals)
    c, d = bootstrap_ci(vals)
    assert (a, b) == (c, d)
    assert a < np.mean(vals) < b


def test_bootstrap_too_few_returns_none():
    assert bootstrap_ci(np.array([1.0, 2.0])) == (None, None)


# ── store idempotency (needs live local Postgres; skipped when down) ──────────


def test_store_insert_idempotent():
    from app.db import StoreUnavailable, connection
    from app.services.edges import store
    from app.services.edges.base import EdgeMeasurement
    try:
        store.init_store()
    except StoreUnavailable:
        pytest.skip("Postgres not reachable")
    m = EdgeMeasurement(edge_key="__test_edge__", edge_ann_pct=1.0, hit_rate=50.0,
                        decile_spread=0.5, n_signals=10, ci_low=0.1, ci_high=0.9,
                        window_start="2024-01-01", window_end="2025-12-31", extras={})
    kw = dict(universe="testuni", period="2099-01", methodology_version="vtest",
              is_backfilled=False)
    try:
        assert store.insert_measurement(m, **kw) is True
        assert store.insert_measurement(m, **kw) is False   # conflict -> no dupe
        hist = store.read_history("__test_edge__", "testuni", "vtest")
        assert len(hist) == 1 and hist[0]["period"] == "2099-01"
    finally:
        with connection() as con:
            con.execute("DELETE FROM edge_measurements WHERE edge_key='__test_edge__'")
