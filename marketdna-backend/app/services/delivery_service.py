"""Delivery Percentage Intelligence Engine.

Loads NSE delivery data from the parquet lake, computes five conviction
signals, and validates each with the same forward-return framework used
by the Indicator Edge Lab.

Signals
───────
1. Accumulation       — vol > 2× avg  AND  delivery > 65%  AND  close > open
2. Distribution       — vol > 2× avg  AND  delivery > 65%  AND  close < open
3. High Delivery Day  — delivery > 70% (any direction)
4. Delivery Spike     — delivery > 1.5× its own 20D avg
5. Vol + Del Spike    — both volume AND delivery spike simultaneously

Each signal reports: win_rate, EV, max_adverse, distribution,
market-regime-conditional win rates.

Data requirement: run ingestion/nse_delivery_downloader.py first.
"""
import logging
from datetime import datetime
from typing import Optional
from pathlib import Path

import numpy as np

from app.config import settings
from app.services.duckdb_client import get_connection
from app.services.regime_service import get_market_regime_series_if_ready
from app.services.stock_metrics import get_universe
from app.models.delivery import (
    SignalOccurrence, DeliverySignalStats, DeliverySignal, DeliveryBar,
    DeliveryReport, DeliverySummaryItem, DeliverySummaryResult,
)

log = logging.getLogger(__name__)


# ─── Constants ────────────────────────────────────────────────────────────────

_FORWARD        = 21     # forward-return horizon (trading days, ~1 month)
_FORWARD_1Y     = 252    # forward-return horizon for 1-year returns
_VOL_AVG_WIN    = 20     # volume average lookback
_DEL_AVG_WIN    = 20     # delivery % average lookback
_MIN_SAMPLES    = 5
_REGIME_THRESH  = 60

_DIST_BUCKETS = [
    ("<-10",   float("-inf"), -10),
    ("-10:-5",         -10,   -5),
    ("-5:0",            -5,    0),
    ("0:5",              0,    5),
    ("5:10",             5,   10),
    (">10",             10, float("inf")),
]

# ─── Module-level caches ──────────────────────────────────────────────────────

_report_cache:   dict[tuple[str, str], DeliveryReport]   = {}
_summary_cache:  tuple[str, DeliverySummaryResult] | None = None
_view_ready:     bool = False

# In-memory delivery data: {symbol: {date_str: delivery_pct}}
# Loaded once from parquet (avoids 8-9s per-symbol scan on non-partitioned file)
_delivery_data:    dict[str, dict[str, float]] | None = None
_delivery_symbols: list[str] | None = None


def _load_delivery_data() -> dict[str, dict[str, float]]:
    """Bulk-load all delivery_data into Python dict — one parquet scan for the whole session."""
    global _delivery_data, _delivery_symbols, _view_ready
    if _delivery_data is not None:
        return _delivery_data
    try:
        con = get_connection()
        rows = con.execute(
            "SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)), delivery_pct "
            "FROM delivery_data ORDER BY symbol, date"
        ).fetchall()
        data: dict[str, dict[str, float]] = {}
        for sym, d, pct in rows:
            if pct is not None:
                data.setdefault(sym, {})[d] = float(pct)
        _delivery_data = data
        _delivery_symbols = sorted(data.keys())
        _view_ready = True  # we just queried delivery_data successfully
        log.info("delivery_service: loaded %d symbols from delivery_data", len(_delivery_symbols))
    except Exception as exc:
        log.warning("delivery_service: failed to load delivery_data — %s", exc)
        _delivery_data = {}
        _delivery_symbols = []
    return _delivery_data


def _get_delivery_symbols() -> list[str]:
    if _delivery_symbols is not None:
        return _delivery_symbols
    _load_delivery_data()
    return _delivery_symbols or []


def preload_all_reports() -> None:
    """Batch-load equities_prices for all delivery symbols in one query, then
    build and cache all delivery reports. Turns 50 serial DuckDB queries into 1.
    """
    syms = _get_delivery_symbols()
    if not syms:
        return
    log.info("delivery_service: batch pre-loading reports for %d symbols", len(syms))

    today = datetime.utcnow().strftime("%Y-%m-%d")
    mkt_series = get_market_regime_series_if_ready()

    # One DuckDB query for all symbols
    con = get_connection()
    sym_sql = ", ".join(f"'{s}'" for s in syms)
    rows = con.execute(
        f"SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)), open, close, volume "
        f"FROM equities_prices WHERE symbol IN ({sym_sql}) ORDER BY symbol, date ASC"
    ).fetchall()

    from collections import defaultdict
    sym_rows: dict[str, list] = defaultdict(list)
    for sym, d, o, c, v in rows:
        sym_rows[sym].append((d, o, c, v))

    del_data = _load_delivery_data()

    for sym, price_list in sym_rows.items():
        if len(price_list) < 100:
            continue
        key = (sym, today)
        if key in _report_cache:
            continue
        try:
            dates   = [r[0] for r in price_list]
            opens   = np.array([r[1] for r in price_list], dtype=float)
            closes  = np.array([r[2] for r in price_list], dtype=float)
            volumes = np.array([r[3] for r in price_list], dtype=float)
            del_map = del_data.get(sym, {})
            del_pct = np.array([del_map.get(d, np.nan) for d in dates], dtype=float)
            result  = _build_report(sym, dates, closes, opens, volumes, del_pct, mkt_series)
            _report_cache[key] = result
        except Exception as exc:
            log.debug("delivery preload: skip %s — %s", sym, exc)

    log.info("delivery_service: pre-loaded %d reports", len([k for k in _report_cache if k[1] == today]))


# ─── DuckDB delivery view (lazy, once per process) ───────────────────────────

def _ensure_delivery_view() -> bool:
    """Check if delivery_data view exists on the current thread's connection."""
    global _view_ready
    if _view_ready:
        return True
    delivery_path = settings.data_path / "data_lake" / "raw" / "delivery"
    if not delivery_path.exists() or not any(delivery_path.rglob("*.parquet")):
        return False
    try:
        con = get_connection()
        # View is created per-thread in get_connection(); verify it exists
        con.execute("SELECT 1 FROM delivery_data LIMIT 0")
        _view_ready = True
        return True
    except Exception:
        return False


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _sma(arr: np.ndarray, w: int) -> np.ndarray:
    result = np.full(len(arr), np.nan)
    for i in range(w - 1, len(arr)):
        result[i] = arr[i - w + 1 : i + 1].mean()
    return result


def _make_distribution(arr: np.ndarray) -> dict[str, int]:
    return {
        label: int(((arr >= lo) & (arr < hi)).sum())
        for label, lo, hi in _DIST_BUCKETS
    }


def _regime_bucket(
    adj_returns: np.ndarray, regime_vals: list[float],
) -> tuple[Optional[float], Optional[float], int, Optional[float], Optional[float], int]:
    if not regime_vals or len(regime_vals) != len(adj_returns):
        return None, None, 0, None, None, 0
    rv    = np.array(regime_vals, dtype=float)
    valid = ~np.isnan(rv)
    h = valid & (rv >= _REGIME_THRESH)
    l = valid & (rv <  _REGIME_THRESH)

    def _cond(mask):
        sub = adj_returns[mask]
        if len(sub) < _MIN_SAMPLES:
            return None, None, len(sub)
        wins   = sub[sub > 0];  losses = sub[sub <= 0]
        wr  = len(wins) / len(sub) * 100
        avg_w = float(wins.mean())   if len(wins)   > 0 else 0.0
        avg_l = float(losses.mean()) if len(losses) > 0 else 0.0
        ev  = (wr / 100) * avg_w + (1 - wr / 100) * avg_l
        return round(wr, 1), round(ev, 2), len(sub)

    wr_h, ev_h, n_h = _cond(h)
    wr_l, ev_l, n_l = _cond(l)
    return wr_h, ev_h, n_h, wr_l, ev_l, n_l


def _compute_signal_stats(
    mask: np.ndarray,
    closes: np.ndarray,
    dates: list[str],
    mkt_series: dict[str, float],
    bearish: bool = False,
) -> Optional[DeliverySignalStats]:
    n = len(closes)
    r1d, r1w, r1m, adverse, mkt_vals, occ_dates = [], [], [], [], [], []

    for i in range(n - _FORWARD):
        if not mask[i]:
            continue
        p0 = closes[i]
        if p0 <= 0:
            continue
        r1d.append((closes[i + 1]        - p0) / p0 * 100)
        r1w.append((closes[i + 5]        - p0) / p0 * 100)
        r1m.append((closes[i + _FORWARD] - p0) / p0 * 100)
        window = closes[i + 1 : i + _FORWARD + 1]
        if bearish:
            adverse.append(max(0.0, (window.max() - p0) / p0 * 100))
        else:
            adverse.append(max(0.0, (p0 - window.min()) / p0 * 100))
        mkt_vals.append(mkt_series.get(dates[i], np.nan))
        occ_dates.append(dates[i])

    if len(r1m) < _MIN_SAMPLES:
        return None

    sign = -1.0 if bearish else 1.0
    a1d_adj = np.array(r1d) * sign
    a1w_adj = np.array(r1w) * sign
    a1m_adj = np.array(r1m) * sign

    wins   = a1m_adj[a1m_adj > 0]
    losses = a1m_adj[a1m_adj <= 0]
    wr  = len(wins) / len(a1m_adj) * 100
    avg_w = float(wins.mean())   if len(wins)   > 0 else 0.0
    avg_l = float(losses.mean()) if len(losses) > 0 else 0.0
    ev  = (wr / 100) * avg_w + (1 - wr / 100) * avg_l

    wr_h, ev_h, n_h, wr_l, ev_l, n_l = _regime_bucket(a1m_adj, mkt_vals)

    # Build timeline — include 1Y return where we have enough forward data
    # All returns are sign-adjusted so positive = trade worked (regardless of direction)
    date_idx = {d: i for i, d in enumerate(dates)}
    timeline: list[SignalOccurrence] = []
    for idx, d in enumerate(occ_dates):
        bar_i = date_idx.get(d, -1)
        ret_1y: Optional[float] = None
        if bar_i >= 0 and bar_i + _FORWARD_1Y < n:
            p0 = closes[bar_i]
            if p0 > 0:
                ret_1y = round((closes[bar_i + _FORWARD_1Y] - p0) / p0 * 100 * sign, 2)
        timeline.append(SignalOccurrence(
            date=d,
            ret_1d=round(float(a1d_adj[idx]), 2),
            ret_1w=round(float(a1w_adj[idx]), 2),
            ret_1m=round(float(a1m_adj[idx]), 2),
            ret_1y=ret_1y,
        ))

    return DeliverySignalStats(
        occurrences   = len(a1m_adj),
        avg_1d        = round(float(a1d_adj.mean()), 2),
        avg_1w        = round(float(a1w_adj.mean()), 2),
        avg_1m        = round(float(a1m_adj.mean()), 2),
        win_rate      = round(wr, 1),
        expected_value= round(ev, 2),
        max_adverse   = round(float(np.mean(adverse)), 2),
        distribution  = _make_distribution(a1m_adj),
        timeline      = timeline,
        mkt_regime_high_win_rate    = wr_h,
        mkt_regime_low_win_rate     = wr_l,
        mkt_regime_high_ev          = ev_h,
        mkt_regime_low_ev           = ev_l,
        mkt_regime_high_occurrences = n_h,
        mkt_regime_low_occurrences  = n_l,
    )


def _grade(st: DeliverySignalStats) -> str:
    wr, ev, n = st.win_rate, st.expected_value, st.occurrences
    if n < _MIN_SAMPLES or ev <= 0: return "D"
    if wr >= 65 and ev >= 3.0 and n >= 15: return "A+"
    if wr >= 60 and ev >= 2.0 and n >= 10: return "A"
    if wr >= 55 and ev >= 1.0 and n >= 5:  return "B"
    if wr >= 50 and n >= 5: return "C"
    return "D"


def _edge_score(st: DeliverySignalStats, total_bars: int) -> float:
    freq = st.occurrences / max(total_bars, 1) * 100
    return round((st.win_rate / 100) * max(0.0, st.expected_value) * freq, 3)


# ─── Main report builder ──────────────────────────────────────────────────────

def _build_report(
    symbol: str,
    dates:   list[str],
    closes:  np.ndarray,
    opens:   np.ndarray,
    volumes: np.ndarray,
    del_pct: np.ndarray,
    mkt_series: dict[str, float],
) -> DeliveryReport:
    n = len(closes)

    vol_avg = _sma(volumes.astype(float), _VOL_AVG_WIN)
    del_avg = _sma(del_pct, _DEL_AVG_WIN)

    vol_ratio = np.where(vol_avg > 0, volumes / vol_avg, 0.0)
    del_ratio = np.where(del_avg > 0, del_pct / del_avg, 0.0)

    valid = ~np.isnan(del_pct) & ~np.isnan(vol_avg)

    # Last bar where delivery data is available (may lag price data by 1-2 days)
    del_valid_idx = np.where(~np.isnan(del_pct))[0]
    li = int(del_valid_idx[-1]) if len(del_valid_idx) > 0 else n - 1
    delivery_bars = int((~np.isnan(del_pct)).sum())

    cur_del_live  = float(del_pct[li])   if not np.isnan(del_pct[li])  else 0.0
    cur_vol_live  = float(vol_ratio[li]) if not np.isnan(vol_ratio[li]) else 0.0
    cur_del_r_live = float(del_ratio[li]) if not np.isnan(del_ratio[li]) else 0.0
    cur_del_avg_live = float(del_avg[li]) if not np.isnan(del_avg[li]) else 0.0

    signals: list[DeliverySignal] = []

    def _add(
        name: str, desc: str, direction: str,
        mask: np.ndarray,
        active: bool,
    ) -> None:
        bearish = direction == "Bearish"
        st = _compute_signal_stats(mask & valid, closes, dates, mkt_series, bearish=bearish)
        if st is None:
            return
        grade = _grade(st)
        if grade == "D":
            return
        signals.append(DeliverySignal(
            name=name, description=desc, direction=direction,
            is_active=bool(active),
            current_delivery_pct=round(cur_del_live, 1),
            current_vol_ratio=round(cur_vol_live, 2),
            grade=grade,
            edge_score=_edge_score(st, delivery_bars),
            stats=st,
        ))

    # ── Signal 1: Accumulation ────────────────────────────────────────────────
    accum_mask = (
        valid &
        (vol_ratio > 2.0) &
        (del_pct >= 65.0) &
        (closes > opens)
    )
    _add(
        "Accumulation",
        "Volume spike (>2×) + high delivery (≥65%) + up close — institutional buying",
        "Bullish", accum_mask,
        active=bool(valid[li] and vol_ratio[li] > 2.0 and del_pct[li] >= 65.0 and closes[li] > opens[li]),
    )

    # ── Signal 2: Distribution ────────────────────────────────────────────────
    dist_mask = (
        valid &
        (vol_ratio > 2.0) &
        (del_pct >= 65.0) &
        (closes < opens)
    )
    _add(
        "Distribution",
        "Volume spike (>2×) + high delivery (≥65%) + down close — institutional selling",
        "Bearish", dist_mask,
        active=bool(valid[li] and vol_ratio[li] > 2.0 and del_pct[li] >= 65.0 and closes[li] < opens[li]),
    )

    # ── Signal 3: High Delivery Day (Bullish) ─────────────────────────────────
    hd_bull_mask = valid & (del_pct >= 70.0) & (closes > opens)
    _add(
        "High Delivery — Up",
        "Delivery ≥70% on an up-close day — conviction buying",
        "Bullish", hd_bull_mask,
        active=bool(valid[li] and del_pct[li] >= 70.0 and closes[li] > opens[li]),
    )

    # ── Signal 4: High Delivery Day (Bearish) ─────────────────────────────────
    hd_bear_mask = valid & (del_pct >= 70.0) & (closes < opens)
    _add(
        "High Delivery — Down",
        "Delivery ≥70% on a down-close day — conviction selling",
        "Bearish", hd_bear_mask,
        active=bool(valid[li] and del_pct[li] >= 70.0 and closes[li] < opens[li]),
    )

    # ── Signal 5: Delivery Spike (abnormal vs own history) ────────────────────
    del_spike_mask = valid & (del_ratio >= 1.5) & ~np.isnan(del_avg)
    _add(
        "Delivery Spike",
        "Delivery % >1.5× its 20D average — abnormal conviction vs recent history",
        "Mixed", del_spike_mask,
        active=bool(valid[li] and del_ratio[li] >= 1.5 and not np.isnan(del_avg[li])),
    )

    # ── Signal 6: Vol + Del Spike ─────────────────────────────────────────────
    both_spike_mask = valid & (vol_ratio >= 1.5) & (del_ratio >= 1.5)
    _add(
        "Vol + Delivery Spike",
        "Both volume AND delivery % spike simultaneously — maximum institutional activity",
        "Mixed", both_spike_mask,
        active=bool(valid[li] and vol_ratio[li] >= 1.5 and del_ratio[li] >= 1.5),
    )

    signals.sort(key=lambda s: s.edge_score, reverse=True)

    # ── History for chart ─────────────────────────────────────────────────────
    start_idx = max(0, n - 252)
    history: list[DeliveryBar] = []
    for i in range(start_idx, n):
        if np.isnan(del_pct[i]):
            continue
        history.append(DeliveryBar(
            date=dates[i],
            close=round(float(closes[i]), 2),
            volume=float(volumes[i]),
            delivery_pct=round(float(del_pct[i]), 1),
            vol_ratio=round(float(vol_ratio[i]) if not np.isnan(vol_ratio[i]) else 0.0, 2),
            delivery_spike=bool(del_ratio[i] >= 1.5 and not np.isnan(del_avg[i])),
        ))

    return DeliveryReport(
        symbol=symbol,
        data_start=dates[0],
        data_end=dates[li],   # last date with actual delivery data
        total_bars=delivery_bars,
        current_delivery_pct=round(cur_del_live, 1),
        avg_delivery_pct_20d=round(cur_del_avg_live, 1),
        signals=signals,
        history=history,
        computed_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )


# ─── Public API ───────────────────────────────────────────────────────────────

def get_delivery_report(symbol: str) -> DeliveryReport:
    if not _ensure_delivery_view():
        raise ValueError("Delivery data not yet ingested. Run: python ingestion/nse_delivery_downloader.py")

    today = datetime.utcnow().strftime("%Y-%m-%d")
    key = (symbol, today)
    if key in _report_cache:
        return _report_cache[key]

    con = get_connection()
    price_rows = con.execute(
        "SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)), open, close, volume "
        "FROM equities_prices WHERE symbol = ? ORDER BY date ASC",
        [symbol]
    ).fetchall()

    if len(price_rows) < 100:
        raise ValueError(f"Insufficient data for {symbol}")

    # Use in-memory delivery dict — avoids repeated 8-9s full parquet scans
    del_map = _load_delivery_data().get(symbol, {})

    dates   = [r[0] for r in price_rows]
    opens   = np.array([r[1] for r in price_rows], dtype=float)
    closes  = np.array([r[2] for r in price_rows], dtype=float)
    volumes = np.array([r[3] for r in price_rows], dtype=float)
    del_pct = np.array([del_map.get(d, np.nan) for d in dates], dtype=float)

    mkt_series = get_market_regime_series_if_ready()  # empty dict if not yet warmed
    result = _build_report(symbol, dates, closes, opens, volumes, del_pct, mkt_series)
    _report_cache[key] = result
    return result


def get_delivery_summary() -> DeliverySummaryResult:
    global _summary_cache
    if not _ensure_delivery_view():
        return DeliverySummaryResult(items=[], total_symbols=0,
                                     computed_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"))

    today = datetime.utcnow().strftime("%Y-%m-%d")
    if _summary_cache and _summary_cache[0] == today:
        return _summary_cache[1]

    items: list[DeliverySummaryItem] = []
    for sym in _get_delivery_symbols():
        try:
            r = get_delivery_report(sym)
            if not r.signals:
                continue
            best = r.signals[0]
            items.append(DeliverySummaryItem(
                symbol=sym,
                current_delivery_pct=r.current_delivery_pct,
                avg_delivery_pct_20d=r.avg_delivery_pct_20d,
                delivery_ratio=round(r.current_delivery_pct / r.avg_delivery_pct_20d, 2)
                    if r.avg_delivery_pct_20d > 0 else 0.0,
                current_vol_ratio=best.current_vol_ratio,
                best_signal=best.name,
                grade=best.grade,
                edge_score=best.edge_score,
                win_rate=best.stats.win_rate,
                is_active=best.is_active,
                mkt_regime_high_win_rate=best.stats.mkt_regime_high_win_rate,
                mkt_regime_low_win_rate=best.stats.mkt_regime_low_win_rate,
            ))
        except Exception as exc:
            log.debug("delivery_summary: skip %s — %s", sym, exc)

    items.sort(key=lambda x: x.edge_score, reverse=True)
    result = DeliverySummaryResult(
        items=items, total_symbols=len(items),
        computed_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )
    _summary_cache = (today, result)
    return result


def invalidate_cache() -> None:
    global _summary_cache
    _report_cache.clear()
    _summary_cache = None
    log.info("delivery_service: cache cleared")
