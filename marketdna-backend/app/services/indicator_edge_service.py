"""Indicator Edge Lab — historical signal analysis engine.

For each indicator + signal condition, finds every historical occurrence
and measures forward returns (1W / 2W / 1M), then ranks indicators by edge.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date as _date, datetime
from typing import Optional

import numpy as np

from app.services.duckdb_client import get_connection
from app.services.indicators_service import _sma, _ema, _rsi, _macd, _stochastic, _bollinger
from app.services.regime_service import _compute_regime_arrays, get_market_regime_series
from app.models.indicator_edge import (
    SignalStats, ThresholdResult, IndicatorEdgeResult,
    CurrentSignal, IndicatorEdgeReport,
    StockEdgeSummaryItem, StockEdgeSummaryResult,
)

log = logging.getLogger(__name__)

MIN_SAMPLES = 5
_FORWARD = 21      # 1 month ≈ 21 trading days

_edge_cache: dict[tuple[str, str], IndicatorEdgeReport] = {}


# ─── Forward-return helpers ────────────────────────────────────────────────────

def _forward_returns(
    mask: np.ndarray,
    closes: np.ndarray,
    regime_scores: Optional[np.ndarray] = None,
) -> tuple[list[float], list[float], list[float], list[float], list[float], list[float]]:
    """Returns (r1w, r2w, r1m, win_min_pct, win_max_pct, regime_at_signal).

    win_min_pct: (min_in_window - entry) / entry  — negative means stock fell
    win_max_pct: (max_in_window - entry) / entry  — positive means stock rose
    regime_at_signal: regime score on the signal bar (nan when unavailable)
    """
    n = len(closes)
    r1w, r2w, r1m, win_min, win_max, regime_vals = [], [], [], [], [], []
    for i in range(n - _FORWARD):
        if not mask[i]:
            continue
        p0 = closes[i]
        if p0 <= 0:
            continue
        r1w.append((closes[i + 5]  - p0) / p0 * 100)
        r2w.append((closes[i + 10] - p0) / p0 * 100)
        r1m.append((closes[i + 21] - p0) / p0 * 100)
        window = closes[i + 1 : i + 22]
        win_min.append((window.min() - p0) / p0 * 100)
        win_max.append((window.max() - p0) / p0 * 100)
        if regime_scores is not None:
            rv = float(regime_scores[i])
            regime_vals.append(rv if not np.isnan(rv) else np.nan)
    return r1w, r2w, r1m, win_min, win_max, regime_vals


_DIST_BUCKETS = [
    ("<-10",  float("-inf"), -10),
    ("-10:-5",        -10,   -5),
    ("-5:0",           -5,    0),
    ("0:5",             0,    5),
    ("5:10",            5,   10),
    (">10",            10, float("inf")),
]


def _make_distribution(a: np.ndarray) -> dict[str, int]:
    return {
        label: int(((a >= lo) & (a < hi)).sum())
        for label, lo, hi in _DIST_BUCKETS
    }


_REGIME_THRESHOLD = 60  # high regime = score >= this


def _regime_bucket(
    a1m_adj: np.ndarray,
    regime_vals: Optional[list[float]],
) -> tuple[Optional[float], Optional[float], int, Optional[float], Optional[float], int]:
    """Split a1m_adj by regime threshold, return (wr_high, ev_high, n_high, wr_low, ev_low, n_low)."""
    wr_high = wr_low = ev_high = ev_low = None
    n_high = n_low = 0
    if not regime_vals or len(regime_vals) != len(a1m_adj):
        return wr_high, ev_high, n_high, wr_low, ev_low, n_low

    rv = np.array(regime_vals, dtype=float)
    valid = ~np.isnan(rv)
    high_mask = valid & (rv >= _REGIME_THRESHOLD)
    low_mask  = valid & (rv <  _REGIME_THRESHOLD)

    def _cond(mask: np.ndarray):
        sub = a1m_adj[mask]
        if len(sub) < MIN_SAMPLES:
            return None, None, len(sub)
        wins   = sub[sub > 0]
        losses = sub[sub <= 0]
        _wr   = len(wins) / len(sub) * 100
        avg_w = float(wins.mean())   if len(wins)   > 0 else 0.0
        avg_l = float(losses.mean()) if len(losses) > 0 else 0.0
        _ev   = (_wr / 100) * avg_w + (1 - _wr / 100) * avg_l
        return round(_wr, 1), round(_ev, 2), len(sub)

    wr_high, ev_high, n_high = _cond(high_mask)
    wr_low,  ev_low,  n_low  = _cond(low_mask)
    return wr_high, ev_high, n_high, wr_low, ev_low, n_low


def _compute_stats(
    r1w: list[float], r2w: list[float], r1m: list[float],
    win_min: list[float], win_max: list[float],
    regime_vals: Optional[list[float]] = None,
    mkt_regime_vals: Optional[list[float]] = None,
    bearish: bool = False,
) -> Optional[SignalStats]:
    """Compute signal statistics.

    For bearish signals, returns are negated so positive = signal worked.
    win_rate  = % of times the signal worked in the predicted direction.
    max_drawdown_1m = avg max adverse excursion during the holding period.
    """
    if len(r1m) < MIN_SAMPLES:
        return None
    # Raw stock returns — always show what the stock ACTUALLY did
    a1w_raw = np.array(r1w)
    a2w_raw = np.array(r2w)
    a1m_raw = np.array(r1m)

    # Direction-adjusted returns — used only for win_rate and EV
    sign = -1.0 if bearish else 1.0
    a1m_adj = a1m_raw * sign

    # Win = signal worked in its predicted direction
    wins_adj   = a1m_adj[a1m_adj > 0]
    losses_adj = a1m_adj[a1m_adj <= 0]
    wr = len(wins_adj) / len(a1m_adj) * 100

    # EV is direction-adjusted (positive = profitable in predicted direction)
    avg_win  = float(wins_adj.mean())   if len(wins_adj)   > 0 else 0.0
    avg_loss = float(losses_adj.mean()) if len(losses_adj) > 0 else 0.0
    ev = (wr / 100) * avg_win + (1 - wr / 100) * avg_loss

    # Raw up/down probabilities (what the stock did, regardless of signal direction)
    up_prob   = float((a1m_raw > 0).sum()) / len(a1m_raw) * 100
    down_prob = float((a1m_raw <= 0).sum()) / len(a1m_raw) * 100

    # Max adverse excursion: how far stock moved against the signal before 1M expiry
    if bearish:
        adverse = np.array([max(v, 0.0) for v in win_max])   # stock rose against short
    else:
        adverse = np.array([max(-v, 0.0) for v in win_min])  # stock dropped against long

    # ── Regime-conditional stats ──────────────────────────────────────────────
    wr_high, ev_high, n_high, wr_low, ev_low, n_low = _regime_bucket(a1m_adj, regime_vals)
    mwr_high, mev_high, mn_high, mwr_low, mev_low, mn_low = _regime_bucket(a1m_adj, mkt_regime_vals)

    return SignalStats(
        occurrences    = len(a1m_raw),
        avg_1w         = round(float(a1w_raw.mean()), 2),   # raw: actual stock move
        avg_2w         = round(float(a2w_raw.mean()), 2),
        avg_1m         = round(float(a1m_raw.mean()), 2),
        median_1m      = round(float(np.median(a1m_raw)), 2),
        max_1m         = round(float(a1m_raw.max()), 2),
        min_1m         = round(float(a1m_raw.min()), 2),
        std_1m         = round(float(a1m_raw.std(ddof=1)), 2) if len(a1m_raw) > 1 else 0.0,
        win_rate       = round(wr, 1),
        positive_prob  = round(up_prob, 1),
        negative_prob  = round(down_prob, 1),
        max_drawdown_1m= round(float(adverse.mean()), 2),
        distribution   = _make_distribution(a1m_raw),
        expected_value = round(ev, 2),
        regime_high_win_rate     = wr_high,
        regime_low_win_rate      = wr_low,
        regime_high_ev           = ev_high,
        regime_low_ev            = ev_low,
        regime_high_occurrences  = n_high,
        regime_low_occurrences   = n_low,
        mkt_regime_high_win_rate    = mwr_high,
        mkt_regime_low_win_rate     = mwr_low,
        mkt_regime_high_ev          = mev_high,
        mkt_regime_low_ev           = mev_low,
        mkt_regime_high_occurrences = mn_high,
        mkt_regime_low_occurrences  = mn_low,
    )


def _grade(st: SignalStats) -> str:
    """Grade uses win_rate and expected_value (direction-adjusted) — not raw avg_1m."""
    wr, ev, n = st.win_rate, st.expected_value, st.occurrences
    if n < MIN_SAMPLES or ev <= 0:
        return "D"
    if wr >= 65 and ev >= 3.0 and n >= 15:
        return "A+"
    if wr >= 60 and ev >= 2.0 and n >= 10:
        return "A"
    if wr >= 55 and ev >= 1.0 and n >= 5:
        return "B"
    if wr >= 50 and n >= 5:
        return "C"
    return "D"


def _edge_score(st: SignalStats, total_bars: int) -> float:
    """Edge score uses direction-adjusted EV so bearish signals that failed score negatively."""
    freq = st.occurrences / max(total_bars, 1) * 100
    return round((st.win_rate / 100) * max(0.0, st.expected_value) * freq, 3)


def _sweep(
    arr: np.ndarray,
    closes: np.ndarray,
    thresholds: list[float],
    above: bool,
    prefix: str,
    op: str,
    bearish: bool = False,
) -> tuple[list[ThresholdResult], Optional[ThresholdResult]]:
    results: list[ThresholdResult] = []
    for thr in thresholds:
        mask = ((arr > thr) if above else (arr < thr)) & ~np.isnan(arr)
        r1w, r2w, r1m, win_min, win_max, _ = _forward_returns(mask, closes)
        st = _compute_stats(r1w, r2w, r1m, win_min, win_max, bearish=bearish)
        if st:
            results.append(ThresholdResult(
                threshold      = thr,
                label          = f"{prefix} {op} {thr}",
                occurrences    = st.occurrences,
                avg_1m         = st.avg_1m,        # raw stock return
                win_rate       = st.win_rate,       # direction-aware
                expected_value = st.expected_value, # direction-adjusted EV
            ))
    best = max(results, key=lambda x: x.expected_value) if results else None
    return results, best


# ─── Crossover helpers ─────────────────────────────────────────────────────────

def _crossover_mask(arr: np.ndarray, up: bool) -> np.ndarray:
    """True on the bar where arr crosses zero upward (up=True) or downward."""
    n = len(arr)
    mask = np.zeros(n, dtype=bool)
    if n < 2:
        return mask
    valid = ~np.isnan(arr[:-1]) & ~np.isnan(arr[1:])
    if up:
        mask[1:] = valid & (arr[:-1] < 0) & (arr[1:] >= 0)
    else:
        mask[1:] = valid & (arr[:-1] > 0) & (arr[1:] <= 0)
    return mask


def _line_crossover(a: np.ndarray, b: np.ndarray, up: bool) -> np.ndarray:
    """True when a crosses b (up=True: a goes above b)."""
    n = len(a)
    mask = np.zeros(n, dtype=bool)
    if n < 2:
        return mask
    valid = ~np.isnan(a[:-1]) & ~np.isnan(b[:-1]) & ~np.isnan(a[1:]) & ~np.isnan(b[1:])
    if up:
        mask[1:] = valid & (a[:-1] <= b[:-1]) & (a[1:] > b[1:])
    else:
        mask[1:] = valid & (a[:-1] >= b[:-1]) & (a[1:] < b[1:])
    return mask


def _forward_returns_fast(
    mask: np.ndarray,
    closes: np.ndarray,
) -> tuple[list[float], list[float], list[float], list[float], list[float]]:
    """Vectorized forward returns — O(K) where K = # signals, not O(n).

    Returns (r1w, r2w, r1m, win_min_pct, win_max_pct).
    Skips regime tracking for use in bulk summary fast-path.
    """
    n = len(closes)
    valid_n = n - _FORWARD
    if valid_n <= 0:
        return [], [], [], [], []
    valid_mask = mask[:valid_n] & (closes[:valid_n] > 0) & ~np.isnan(closes[:valid_n])
    idxs = np.where(valid_mask)[0]
    if len(idxs) == 0:
        return [], [], [], [], []
    entry   = closes[idxs]
    r1w     = ((closes[idxs + 5]  - entry) / entry * 100).tolist()
    r2w     = ((closes[idxs + 10] - entry) / entry * 100).tolist()
    r1m     = ((closes[idxs + 21] - entry) / entry * 100).tolist()
    w_idx   = idxs[:, None] + np.arange(1, 22)   # (K, 21) window indices
    windows = closes[w_idx]
    win_min = ((windows.min(axis=1) - entry) / entry * 100).tolist()
    win_max = ((windows.max(axis=1) - entry) / entry * 100).tolist()
    return r1w, r2w, r1m, win_min, win_max


# ─── Core builder ─────────────────────────────────────────────────────────────

def _build_report(
    symbol: str,
    closes: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    volumes: np.ndarray,
    dates: list[str],
) -> IndicatorEdgeReport:
    n = len(closes)

    rsi_arr                          = _rsi(closes)
    macd_line, macd_sig, macd_hist   = _macd(closes)
    stoch_k, stoch_d                 = _stochastic(highs, lows, closes)
    _, _, _, pct_b                   = _bollinger(closes)
    sma20    = _sma(closes, 20)
    sma50    = _sma(closes, 50)
    sma100   = _sma(closes, 100)
    sma200   = _sma(closes, 200)
    vol_sma  = _sma(volumes.astype(float), 20)
    vol_ratio = np.where(vol_sma > 0, volumes / vol_sma, 0.0)

    # Stock regime score at every bar
    regime_arr, _, _, _ = _compute_regime_arrays(closes, sma20, sma50, sma100, sma200)

    # Market regime series (avg across all 50 stocks) — aligned to this stock's dates
    mkt_series    = get_market_regime_series()
    mkt_regime_arr = np.array([mkt_series.get(d, np.nan) for d in dates], dtype=float)

    results: list[IndicatorEdgeResult] = []

    def _add(
        name: str, signal: str, category: str, direction: str,
        mask: np.ndarray,
        sweep_arr: Optional[np.ndarray] = None,
        sweep_thresholds: Optional[list[float]] = None,
        sweep_above: bool = False,
        sweep_prefix: str = "",
        sweep_op: str = "",
        active: bool = False,
    ) -> None:
        bearish = direction == "Bearish"
        r1w, r2w, r1m, win_min, win_max, regime_vals = _forward_returns(mask, closes, regime_arr)
        # Market regime vals aligned to the same signal bars
        mkt_regime_vals = [
            float(mkt_regime_arr[i])
            for i in range(n - _FORWARD)
            if mask[i] and closes[i] > 0
        ]
        st = _compute_stats(r1w, r2w, r1m, win_min, win_max, regime_vals, mkt_regime_vals, bearish=bearish)
        if st is None:
            return
        sweep, best = [], None
        if sweep_arr is not None and sweep_thresholds:
            sweep, best = _sweep(
                sweep_arr, closes, sweep_thresholds,
                sweep_above, sweep_prefix, sweep_op, bearish=bearish,
            )
        results.append(IndicatorEdgeResult(
            name=name, signal=signal, category=category, direction=direction,
            stats=st, grade=_grade(st), edge_score=_edge_score(st, n),
            threshold_sweep=sweep, best_threshold=best, is_active=active,
        ))

    # ── RSI ───────────────────────────────────────────────────────────────────
    rsi_last = float(rsi_arr[n - 1]) if not np.isnan(rsi_arr[n - 1]) else 50.0

    _add("RSI", "RSI < 30 (Oversold)", "Momentum", "Bullish",
         (rsi_arr < 30) & ~np.isnan(rsi_arr),
         rsi_arr, [40, 35, 30, 25, 20], False, "RSI", "<",
         active=rsi_last < 30)

    _add("RSI", "RSI > 70 (Overbought)", "Momentum", "Bearish",
         (rsi_arr > 70) & ~np.isnan(rsi_arr),
         rsi_arr, [60, 65, 70, 75, 80], True, "RSI", ">",
         active=rsi_last > 70)

    # ── MACD ──────────────────────────────────────────────────────────────────
    macd_h_last = float(macd_hist[n - 1]) if not np.isnan(macd_hist[n - 1]) else 0.0
    bull_cross = _crossover_mask(macd_hist, up=True)
    bear_cross = _crossover_mask(macd_hist, up=False)

    _add("MACD", "MACD Bullish Cross", "Momentum", "Bullish", bull_cross,
         active=bool(bull_cross[n - 1]))
    _add("MACD", "MACD Bearish Cross", "Momentum", "Bearish", bear_cross,
         active=bool(bear_cross[n - 1]))

    # ── Bollinger %B ──────────────────────────────────────────────────────────
    pct_b_last = float(pct_b[n - 1]) if not np.isnan(pct_b[n - 1]) else 50.0

    _add("Bollinger %B", "%B < 20 (Near Lower Band)", "Volatility", "Bullish",
         (pct_b < 20) & ~np.isnan(pct_b),
         pct_b, [30, 20, 10], False, "%B", "<",
         active=pct_b_last < 20)

    _add("Bollinger %B", "%B > 80 (Near Upper Band)", "Volatility", "Bearish",
         (pct_b > 80) & ~np.isnan(pct_b),
         pct_b, [70, 80, 90], True, "%B", ">",
         active=pct_b_last > 80)

    # ── Stochastic ────────────────────────────────────────────────────────────
    sk_last = float(stoch_k[n - 1]) if not np.isnan(stoch_k[n - 1]) else 50.0
    sd_last = float(stoch_d[n - 1]) if not np.isnan(stoch_d[n - 1]) else 50.0

    _add("Stochastic", "Stoch K & D < 20 (Oversold)", "Momentum", "Bullish",
         (stoch_k < 20) & (stoch_d < 20) & ~np.isnan(stoch_k) & ~np.isnan(stoch_d),
         stoch_k, [30, 25, 20, 15, 10], False, "Stoch K", "<",
         active=sk_last < 20 and sd_last < 20)

    _add("Stochastic", "Stoch K & D > 80 (Overbought)", "Momentum", "Bearish",
         (stoch_k > 80) & (stoch_d > 80) & ~np.isnan(stoch_k) & ~np.isnan(stoch_d),
         active=sk_last > 80 and sd_last > 80)

    # ── Volume Spike ──────────────────────────────────────────────────────────
    vr_last = float(vol_ratio[n - 1])

    _add("Volume", "Volume Spike (Ratio > 2x)", "Volume", "Mixed",
         (vol_ratio > 2.0) & ~np.isnan(vol_ratio),
         vol_ratio, [1.5, 2.0, 2.5, 3.0], True, "Vol Ratio", ">",
         active=vr_last > 2.0)

    # ── SMA 200 crossovers ────────────────────────────────────────────────────
    price_cross_above_200 = _line_crossover(closes, sma200, up=True)
    price_cross_below_200 = _line_crossover(closes, sma200, up=False)

    _add("SMA 200", "Price Crosses Above SMA 200", "Trend", "Bullish",
         price_cross_above_200, active=bool(price_cross_above_200[n - 1]))
    _add("SMA 200", "Price Crosses Below SMA 200", "Trend", "Bearish",
         price_cross_below_200, active=bool(price_cross_below_200[n - 1]))

    # ── Golden / Death Cross ──────────────────────────────────────────────────
    _add("MA Cross", "Golden Cross (SMA50 > SMA200)", "Trend", "Bullish",
         _line_crossover(sma50, sma200, up=True),
         active=bool(_line_crossover(sma50, sma200, up=True)[n - 1]))

    _add("MA Cross", "Death Cross (SMA50 < SMA200)", "Trend", "Bearish",
         _line_crossover(sma50, sma200, up=False),
         active=bool(_line_crossover(sma50, sma200, up=False)[n - 1]))

    # ── Rank ──────────────────────────────────────────────────────────────────
    results.sort(key=lambda x: x.edge_score, reverse=True)

    # ── Current signals ───────────────────────────────────────────────────────
    sig_map = {r.signal: r.stats for r in results}

    def _cur_stats(key: str) -> Optional[SignalStats]:
        return sig_map.get(key)

    rsi_label = (
        "Oversold" if rsi_last < 30 else
        "Near Oversold" if rsi_last < 40 else
        "Overbought" if rsi_last > 70 else
        "Near Overbought" if rsi_last > 60 else
        "Neutral"
    )
    current_signals = [
        CurrentSignal(
            indicator="RSI (14)", current_value=f"{rsi_last:.1f}",
            signal_label=rsi_label,
            is_active=rsi_last < 30 or rsi_last > 70,
            stats=_cur_stats("RSI < 30 (Oversold)") if rsi_last < 30
                  else _cur_stats("RSI > 70 (Overbought)") if rsi_last > 70
                  else None,
        ),
        CurrentSignal(
            indicator="MACD Histogram", current_value=f"{macd_h_last:+.4f}",
            signal_label="Positive" if macd_h_last > 0 else "Negative",
            is_active=bool(bull_cross[n - 1] or bear_cross[n - 1]),
            stats=_cur_stats("MACD Bullish Cross") if bull_cross[n - 1]
                  else _cur_stats("MACD Bearish Cross") if bear_cross[n - 1]
                  else None,
        ),
        CurrentSignal(
            indicator="Bollinger %B", current_value=f"{pct_b_last:.1f}%",
            signal_label=(
                "Near Lower Band" if pct_b_last < 20 else
                "Near Upper Band" if pct_b_last > 80 else "Neutral"
            ),
            is_active=pct_b_last < 20 or pct_b_last > 80,
            stats=_cur_stats("%B < 20 (Near Lower Band)") if pct_b_last < 20
                  else _cur_stats("%B > 80 (Near Upper Band)") if pct_b_last > 80
                  else None,
        ),
        CurrentSignal(
            indicator="Stochastic", current_value=f"K={sk_last:.1f} D={sd_last:.1f}",
            signal_label=(
                "Oversold" if sk_last < 20 and sd_last < 20 else
                "Overbought" if sk_last > 80 and sd_last > 80 else "Neutral"
            ),
            is_active=(sk_last < 20 and sd_last < 20) or (sk_last > 80 and sd_last > 80),
            stats=_cur_stats("Stoch K & D < 20 (Oversold)") if sk_last < 20 and sd_last < 20
                  else _cur_stats("Stoch K & D > 80 (Overbought)") if sk_last > 80 and sd_last > 80
                  else None,
        ),
        CurrentSignal(
            indicator="Volume Ratio", current_value=f"{vr_last:.2f}×",
            signal_label="Spike" if vr_last > 2.0 else "Normal" if vr_last > 0.5 else "Dry",
            is_active=vr_last > 2.0,
            stats=_cur_stats("Volume Spike (Ratio > 2x)") if vr_last > 2.0 else None,
        ),
    ]

    best = results[0] if results else None
    return IndicatorEdgeReport(
        symbol=symbol,
        data_start=dates[0],
        data_end=dates[-1],
        total_bars=n,
        results=results,
        ranked_indicators=[r.signal for r in results],
        best_indicator=best.name if best else "N/A",
        best_setup=best.signal if best else "N/A",
        current_signals=current_signals,
        computed_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )


# ─── Fast summary builder (no sweeps, no regime, vectorized) ──────────────────

def _build_report_fast(
    symbol: str,
    closes: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    volumes: np.ndarray,
) -> Optional[StockEdgeSummaryItem]:
    """Compute the best indicator edge for one stock — fast path for bulk summary.

    Skips threshold sweeps, regime-conditional stats, current signals, and market
    regime alignment.  Uses vectorised crossovers and O(K) forward-return indexing.
    """
    n = len(closes)
    if n < 100:
        return None

    rsi_arr                  = _rsi(closes)
    _, _, macd_hist          = _macd(closes)
    stoch_k, stoch_d         = _stochastic(highs, lows, closes)
    _, _, _, pct_b           = _bollinger(closes)
    sma20    = _sma(closes, 20)
    sma50    = _sma(closes, 50)
    sma200   = _sma(closes, 200)
    vol_sma  = _sma(volumes.astype(float), 20)
    vol_ratio = np.where(vol_sma > 0, volumes / vol_sma, 0.0)

    # Vectorised crossover masks
    bull_cross  = _crossover_mask(macd_hist, up=True)
    bear_cross  = _crossover_mask(macd_hist, up=False)
    p_above_200 = _line_crossover(closes, sma200, up=True)
    p_below_200 = _line_crossover(closes, sma200, up=False)
    golden      = _line_crossover(sma50, sma200, up=True)
    death       = _line_crossover(sma50, sma200, up=False)

    rsi_last   = float(rsi_arr[-1])   if not np.isnan(rsi_arr[-1])   else 50.0
    pct_b_last = float(pct_b[-1])     if not np.isnan(pct_b[-1])     else 50.0
    sk_last    = float(stoch_k[-1])   if not np.isnan(stoch_k[-1])   else 50.0
    sd_last    = float(stoch_d[-1])   if not np.isnan(stoch_d[-1])   else 50.0
    vr_last    = float(vol_ratio[-1])

    signal_defs = [
        ("RSI",          "RSI < 30 (Oversold)",            "Bullish",
         (rsi_arr < 30)  & ~np.isnan(rsi_arr),             rsi_last < 30),
        ("RSI",          "RSI > 70 (Overbought)",           "Bearish",
         (rsi_arr > 70)  & ~np.isnan(rsi_arr),             rsi_last > 70),
        ("MACD",         "MACD Bullish Cross",              "Bullish",
         bull_cross,                                        bool(bull_cross[-1])),
        ("MACD",         "MACD Bearish Cross",              "Bearish",
         bear_cross,                                        bool(bear_cross[-1])),
        ("Bollinger %B", "%B < 20 (Near Lower Band)",       "Bullish",
         (pct_b < 20)    & ~np.isnan(pct_b),               pct_b_last < 20),
        ("Bollinger %B", "%B > 80 (Near Upper Band)",       "Bearish",
         (pct_b > 80)    & ~np.isnan(pct_b),               pct_b_last > 80),
        ("Stochastic",   "Stoch K & D < 20 (Oversold)",    "Bullish",
         (stoch_k < 20)  & (stoch_d < 20)
         & ~np.isnan(stoch_k) & ~np.isnan(stoch_d),        sk_last < 20 and sd_last < 20),
        ("Stochastic",   "Stoch K & D > 80 (Overbought)",  "Bearish",
         (stoch_k > 80)  & (stoch_d > 80)
         & ~np.isnan(stoch_k) & ~np.isnan(stoch_d),        sk_last > 80 and sd_last > 80),
        ("Volume",       "Volume Spike (Ratio > 2x)",       "Mixed",
         (vol_ratio > 2.0) & ~np.isnan(vol_ratio),         vr_last > 2.0),
        ("SMA 200",      "Price Crosses Above SMA 200",     "Bullish",
         p_above_200,                                       bool(p_above_200[-1])),
        ("SMA 200",      "Price Crosses Below SMA 200",     "Bearish",
         p_below_200,                                       bool(p_below_200[-1])),
        ("MA Cross",     "Golden Cross (SMA50 > SMA200)",   "Bullish",
         golden,                                            bool(golden[-1])),
        ("MA Cross",     "Death Cross (SMA50 < SMA200)",    "Bearish",
         death,                                             bool(death[-1])),
    ]

    best_item: Optional[StockEdgeSummaryItem] = None
    best_score = -1.0

    for name, signal, direction, mask, is_active in signal_defs:
        r1w, r2w, r1m, win_min, win_max = _forward_returns_fast(mask, closes)
        st = _compute_stats(r1w, r2w, r1m, win_min, win_max, bearish=(direction == "Bearish"))
        if st is None:
            continue
        es = _edge_score(st, n)
        if es > best_score:
            best_score = es
            best_item  = StockEdgeSummaryItem(
                symbol          = symbol,
                best_indicator  = name,
                best_signal     = signal,
                grade           = _grade(st),
                direction       = direction,
                edge_score      = es,
                win_rate        = st.win_rate,
                avg_1m          = st.avg_1m,
                negative_prob   = st.negative_prob,
                max_drawdown_1m = st.max_drawdown_1m,
                expected_value  = st.expected_value,
                occurrences     = st.occurrences,
                is_active       = is_active,
            )

    return best_item


# ─── Public API ───────────────────────────────────────────────────────────────

def get_edge_report(symbol: str) -> IndicatorEdgeReport:
    today     = _date.today().isoformat()
    cache_key = (symbol, today)
    if cache_key in _edge_cache:
        return _edge_cache[cache_key]

    con  = get_connection()
    rows = con.execute("""
        SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)), close, high, low, volume
        FROM equities_prices
        WHERE symbol = ?
        ORDER BY date ASC
    """, [symbol]).fetchall()

    if len(rows) < 100:
        raise ValueError(f"Insufficient data for {symbol}: only {len(rows)} bars")

    dates   = [r[0] for r in rows]
    closes  = np.array([r[1] for r in rows], dtype=float)
    highs   = np.array([r[2] for r in rows], dtype=float)
    lows    = np.array([r[3] for r in rows], dtype=float)
    volumes = np.array([r[4] for r in rows], dtype=float)

    result = _build_report(symbol, closes, highs, lows, volumes, dates)
    _edge_cache[cache_key] = result
    return result


_summary_cache: tuple[str, StockEdgeSummaryResult] | None = None


def get_edge_summary() -> StockEdgeSummaryResult:
    """Compute best indicator edge for every symbol.

    Strategy:
    1. Batch-load all symbols from DuckDB in one query (shared with pattern_service cache).
    2. Run _build_report_fast per symbol in a ThreadPoolExecutor (numpy releases GIL).
    3. Sort by edge_score descending and cache for the day.

    Cold: ~8–12s.  Warm (cache hit): <1ms.
    """
    global _summary_cache
    today = _date.today().isoformat()
    if _summary_cache and _summary_cache[0] == today:
        return _summary_cache[1]

    # Deferred import avoids module-level circular-dependency risk
    from app.services.pattern_service import _load_all_data  # {sym: (closes,highs,lows,vols,dates)}

    log.info("edge_summary: loading batch data…")
    all_data = _load_all_data('daily')
    log.info("edge_summary: computing %d symbols with 4 threads…", len(all_data))

    items: list[StockEdgeSummaryItem] = []

    def _task(sym: str, arrays: tuple) -> Optional[StockEdgeSummaryItem]:
        closes, highs, lows, vols, _ = arrays
        try:
            return _build_report_fast(sym, closes, highs, lows, vols)
        except Exception as exc:
            log.debug("edge_summary skip %s: %s", sym, exc)
            return None

    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = {pool.submit(_task, sym, data): sym for sym, data in all_data.items()}
        for fut in as_completed(futs):
            res = fut.result()
            if res is not None:
                items.append(res)

    items.sort(key=lambda x: x.edge_score, reverse=True)
    result = StockEdgeSummaryResult(
        items          = items,
        total_symbols  = len(items),
        computed_at    = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )
    _summary_cache = (today, result)
    log.info("edge_summary: done — %d symbols", len(items))
    return result


def invalidate_cache() -> None:
    global _summary_cache
    _edge_cache.clear()
    _summary_cache = None
    log.info("indicator_edge: cache cleared")
