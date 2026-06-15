"""Cointegration Pairs Engine.

Identifies cointegrated pairs within NIFTY 50, computes spread Z-scores,
and validates mean-reversion signals using the same forward-return framework
as the Indicator Edge Lab.

Pipeline
────────
1. Load all 50 stocks' log-price series in one DuckDB query.
2. Correlation pre-filter: keep pairs where |Pearson r| ≥ 0.70.
   Eliminates ~65% of pairs before the expensive ADF step.
3. Engle-Granger cointegration test on log-price residuals.
4. For valid pairs (p < 0.05): compute hedge ratio, half-life, rolling Z-score.
5. Signal validation: measure forward spread returns for Z < -2 and Z > +2.
6. Market-regime-conditional win rates (same threshold-60 split as Edge Lab).

Caching: full scan cached per calendar day.  First call triggers background
preload so subsequent requests are instant.
"""
import logging
import threading
from collections import defaultdict
from datetime import datetime
from typing import Optional

import numpy as np
from statsmodels.regression.linear_model import OLS
from statsmodels.tools import add_constant
from statsmodels.tsa.stattools import adfuller

from app.services.duckdb_client import get_connection
from app.services.regime_service import get_universe, get_market_regime_series
from app.models.cointegration import (
    SpreadSignalStats, PairResult, CointegrationScanResult,
)

log = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

_CORR_THRESHOLD  = 0.70   # pre-filter: |Pearson r| on log prices
_PVALUE_THRESH   = 0.05   # Engle-Granger p-value cutoff
_Z_ENTRY         = 2.0    # Z-score entry threshold
_FORWARD         = 21     # forward-return horizon (trading days)
_ZSCORE_WINDOW   = 252    # rolling Z-score lookback
_MIN_SAMPLES     = 5      # minimum signal occurrences to compute stats
_REGIME_THRESH   = 60     # market-regime bucket split
_MAX_SYMBOLS     = 150    # pairwise ADF is O(n²) — cap universe to keep scan <60s

_DIST_BUCKETS = [
    ("<-5",    float("-inf"), -5),
    ("-5:-2",          -5,   -2),
    ("-2:0",           -2,    0),
    ("0:2",             0,    2),
    ("2:5",             2,    5),
    (">5",              5, float("inf")),
]

# ─── Day-level cache ──────────────────────────────────────────────────────────

_scan_cache: dict[str, CointegrationScanResult] = {}
_scan_lock = threading.Lock()   # prevents duplicate ADF computation


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _align(
    dates_a: list[str], closes_a: np.ndarray,
    dates_b: list[str], closes_b: np.ndarray,
) -> tuple[list[str], np.ndarray, np.ndarray]:
    """Return (common_dates, aligned_a, aligned_b) on the intersection of dates."""
    map_a = dict(zip(dates_a, closes_a))
    map_b = dict(zip(dates_b, closes_b))
    common = sorted(set(map_a) & set(map_b))
    return common, np.array([map_a[d] for d in common]), np.array([map_b[d] for d in common])


def _engle_granger(
    y_log: np.ndarray, x_log: np.ndarray
) -> tuple[float, float, np.ndarray]:
    """OLS regression on log prices → ADF test on residuals.

    Returns (p_value, hedge_ratio, spread) where
    spread = y_log - hedge_ratio * x_log.
    """
    X = add_constant(x_log)
    model = OLS(y_log, X).fit()
    hedge_ratio = float(model.params[1])
    spread = y_log - hedge_ratio * x_log
    adf_result = adfuller(spread, maxlag=1, autolag=None)
    return float(adf_result[1]), hedge_ratio, spread


def _half_life(spread: np.ndarray) -> float:
    """Estimate mean-reversion half-life via AR(1) regression on spread differences."""
    delta  = np.diff(spread)
    lagged = spread[:-1] - spread[:-1].mean()
    # beta = cov(delta, lagged) / var(lagged)
    denom = np.dot(lagged, lagged)
    if denom == 0:
        return 999.0
    beta = float(np.dot(lagged, delta) / denom)
    if beta >= 0:
        return 999.0
    hl = -np.log(2) / beta
    return round(min(hl, 999.0), 1)


def _rolling_zscore(spread: np.ndarray, window: int = _ZSCORE_WINDOW) -> np.ndarray:
    """Rolling Z-score: (spread - mean) / std over a lookback window."""
    n = len(spread)
    z = np.full(n, np.nan)
    for i in range(window, n):
        w = spread[i - window : i]
        mu, sigma = w.mean(), w.std()
        if sigma > 0:
            z[i] = (spread[i] - mu) / sigma
    return z


def _make_distribution(arr: np.ndarray) -> dict[str, int]:
    return {
        label: int(((arr >= lo) & (arr < hi)).sum())
        for label, lo, hi in _DIST_BUCKETS
    }


def _regime_bucket(
    returns: np.ndarray,
    regime_vals: list[float],
) -> tuple[Optional[float], Optional[float], int, Optional[float], Optional[float], int]:
    """Split returns array by market regime threshold; return (wr_h, ev_h, n_h, wr_l, ev_l, n_l)."""
    if not regime_vals or len(regime_vals) != len(returns):
        return None, None, 0, None, None, 0

    rv    = np.array(regime_vals, dtype=float)
    valid = ~np.isnan(rv)
    h_mask = valid & (rv >= _REGIME_THRESH)
    l_mask = valid & (rv <  _REGIME_THRESH)

    def _cond(mask: np.ndarray):
        sub = returns[mask]
        if len(sub) < _MIN_SAMPLES:
            return None, None, len(sub)
        wins   = sub[sub > 0]
        losses = sub[sub <= 0]
        wr  = len(wins) / len(sub) * 100
        avg_w = float(wins.mean())   if len(wins)   > 0 else 0.0
        avg_l = float(losses.mean()) if len(losses) > 0 else 0.0
        ev  = (wr / 100) * avg_w + (1 - wr / 100) * avg_l
        return round(wr, 1), round(ev, 2), len(sub)

    wr_h, ev_h, n_h = _cond(h_mask)
    wr_l, ev_l, n_l = _cond(l_mask)
    return wr_h, ev_h, n_h, wr_l, ev_l, n_l


def _validate_spread(
    zscore:     np.ndarray,
    spread:     np.ndarray,
    dates:      list[str],
    mkt_series: dict[str, float],
) -> tuple[Optional[SpreadSignalStats], Optional[SpreadSignalStats]]:
    """Compute forward-return statistics for long (Z < -2) and short (Z > +2) signals.

    Returns are expressed as spread-change × 100 (log-spread percentage units).
    Win = spread moved toward zero (converged) within 21 bars.
    """
    n = len(spread)
    long_r1w, long_r1m, long_adv, long_mkt = [], [], [], []
    short_r1w, short_r1m, short_adv, short_mkt = [], [], [], []

    for i in range(n - _FORWARD):
        if np.isnan(zscore[i]):
            continue
        s0  = spread[i]
        window = spread[i : i + _FORWARD + 1]
        r1w = (spread[i + 5]  - s0) * 100
        r1m = (spread[i + _FORWARD] - s0) * 100
        mkt_r = mkt_series.get(dates[i], np.nan) if dates else np.nan

        if zscore[i] < -_Z_ENTRY:
            long_r1w.append(r1w)
            long_r1m.append(r1m)
            long_mkt.append(mkt_r)
            # Max adverse: how far spread fell against the long position
            long_adv.append(max(0.0, (s0 - window.min()) * 100))

        elif zscore[i] > _Z_ENTRY:
            # Short spread: profit when spread falls — negate returns
            short_r1w.append(-r1w)
            short_r1m.append(-r1m)
            short_mkt.append(mkt_r)
            # Max adverse: how far spread rose against the short position
            short_adv.append(max(0.0, (window.max() - s0) * 100))

    def _make(r1w_list, r1m_list, adv_list, mkt_list) -> Optional[SpreadSignalStats]:
        if len(r1m_list) < _MIN_SAMPLES:
            return None
        a1w = np.array(r1w_list)
        a1m = np.array(r1m_list)
        wins   = a1m[a1m > 0]
        losses = a1m[a1m <= 0]
        wr  = len(wins) / len(a1m) * 100
        avg_w = float(wins.mean())   if len(wins)   > 0 else 0.0
        avg_l = float(losses.mean()) if len(losses) > 0 else 0.0
        ev  = (wr / 100) * avg_w + (1 - wr / 100) * avg_l
        wr_h, ev_h, n_h, wr_l, ev_l, n_l = _regime_bucket(a1m, mkt_list)
        return SpreadSignalStats(
            occurrences   = len(a1m),
            avg_1w        = round(float(a1w.mean()), 3),
            avg_1m        = round(float(a1m.mean()), 3),
            win_rate      = round(wr, 1),
            expected_value= round(ev, 3),
            max_adverse   = round(float(np.mean(adv_list)), 3),
            distribution  = _make_distribution(a1m),
            mkt_regime_high_win_rate    = wr_h,
            mkt_regime_low_win_rate     = wr_l,
            mkt_regime_high_ev          = ev_h,
            mkt_regime_low_ev           = ev_l,
            mkt_regime_high_occurrences = n_h,
            mkt_regime_low_occurrences  = n_l,
        )

    return _make(long_r1w, long_r1m, long_adv, long_mkt), \
           _make(short_r1w, short_r1m, short_adv, short_mkt)


def _grade(p_value: float, half_life: float, best_wr: Optional[float]) -> str:
    if p_value > _PVALUE_THRESH or best_wr is None:
        return "C"
    if p_value < 0.01 and half_life <= 15 and best_wr >= 63:
        return "A+"
    if p_value < 0.02 and half_life <= 25 and best_wr >= 58:
        return "A"
    if p_value < 0.05 and half_life <= 45:
        return "B"
    return "C"


# ─── Main scan ────────────────────────────────────────────────────────────────

def _compute_scan() -> CointegrationScanResult:
    """Full ADF computation. Must only be called while holding _scan_lock."""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    log.info("cointegration: starting scan")
    con = get_connection()
    symbols_sql = ", ".join(f"'{s}'" for s in get_universe())

    rows = con.execute(f"""
        SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)), close
        FROM equities_prices
        WHERE symbol IN ({symbols_sql})
        ORDER BY symbol, date
    """).fetchall()

    # Build per-symbol arrays
    sym_dates:  dict[str, list[str]]   = defaultdict(list)
    sym_closes: dict[str, list[float]] = defaultdict(list)
    for sym, d, c in rows:
        sym_dates[sym].append(d)
        sym_closes[sym].append(float(c))

    all_data: dict[str, tuple[list[str], np.ndarray]] = {
        sym: (sym_dates[sym], np.array(sym_closes[sym], dtype=float))
        for sym in sym_dates
        if len(sym_dates[sym]) >= 300
    }
    # Sort by data length descending (most history = most established) then cap
    valid_syms = sorted(all_data.keys(), key=lambda s: len(all_data[s][0]), reverse=True)[:_MAX_SYMBOLS]
    valid_syms = sorted(valid_syms)  # restore alphabetical for determinism

    # ── Step 1: Correlation pre-filter ────────────────────────────────────────
    # Align all symbols to common dates using shortest available window
    min_len = min(len(all_data[s][0]) for s in valid_syms)
    window  = min(min_len, 756)

    log_tails: dict[str, np.ndarray] = {
        sym: np.log(all_data[sym][1][-window:])
        for sym in valid_syms
    }

    candidate_pairs: list[tuple[str, str]] = []
    n_syms = len(valid_syms)
    for i in range(n_syms):
        for j in range(i + 1, n_syms):
            sy, sx = valid_syms[i], valid_syms[j]
            r = float(np.corrcoef(log_tails[sy], log_tails[sx])[0, 1])
            if abs(r) >= _CORR_THRESHOLD:
                candidate_pairs.append((sy, sx))

    total_universe = n_syms * (n_syms - 1) // 2
    log.info("cointegration: %d/%d pairs passed correlation filter", len(candidate_pairs), total_universe)

    # ── Step 2: Engle-Granger on candidates ───────────────────────────────────
    mkt_series = get_market_regime_series()
    valid_results: list[PairResult] = []

    for sy, sx in candidate_pairs:
        try:
            dates_y, closes_y = all_data[sy]
            dates_x, closes_x = all_data[sx]
            common, cy, cx = _align(dates_y, closes_y, dates_x, closes_x)
            if len(common) < 300:
                continue

            y_log = np.log(cy)
            x_log = np.log(cx)

            # Correlation on full aligned series
            corr = float(np.corrcoef(y_log, x_log)[0, 1])

            p_val, hedge_ratio, spread = _engle_granger(y_log, x_log)
            if p_val > _PVALUE_THRESH:
                continue

            hl      = _half_life(spread)
            zscore  = _rolling_zscore(spread)
            cur_z   = float(zscore[-1]) if not np.isnan(zscore[-1]) else 0.0

            # Spread stats on full history
            s_mean = float(spread.mean())
            s_std  = float(spread.std())

            # Signal validation
            long_st, short_st = _validate_spread(zscore, spread, common, mkt_series)

            best_wr = max(
                (long_st.win_rate  if long_st  else 0),
                (short_st.win_rate if short_st else 0),
            ) or None

            # History for chart: last 252 valid Z-score bars
            valid_idx = [i for i in range(len(common)) if not np.isnan(zscore[i])]
            hist_idx  = valid_idx[-252:]
            z_history   = [round(float(zscore[i]), 3) for i in hist_idx]
            date_history = [common[i] for i in hist_idx]

            valid_results.append(PairResult(
                symbol_y      = sy,
                symbol_x      = sx,
                p_value       = round(p_val, 4),
                hedge_ratio   = round(hedge_ratio, 4),
                half_life     = hl,
                correlation   = round(corr, 3),
                spread_mean   = round(s_mean, 5),
                spread_std    = round(s_std, 5),
                current_zscore= round(cur_z, 3),
                grade         = _grade(p_val, hl, best_wr),
                long_stats    = long_st,
                short_stats   = short_st,
                zscore_history= z_history,
                dates         = date_history,
                computed_at   = today,
            ))

        except Exception as exc:
            log.debug("cointegration: skip %s/%s — %s", sy, sx, exc)

    # Sort by grade then p-value
    grade_order = {"A+": 0, "A": 1, "B": 2, "C": 3}
    valid_results.sort(key=lambda r: (grade_order.get(r.grade, 9), r.p_value))

    result = CointegrationScanResult(
        pairs                    = valid_results,
        total_pairs_universe     = total_universe,
        total_correlation_passed = len(candidate_pairs),
        total_cointegrated       = len(valid_results),
        correlation_threshold    = _CORR_THRESHOLD,
        pvalue_threshold         = _PVALUE_THRESH,
        computed_at              = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )
    _scan_cache[today] = result
    log.info("cointegration: scan complete — %d valid pairs", len(valid_results))
    return result


def get_cointegration_scan() -> CointegrationScanResult:
    today = datetime.utcnow().strftime("%Y-%m-%d")
    if today in _scan_cache:
        return _scan_cache[today]
    with _scan_lock:
        # Re-check inside lock: another thread may have finished while we waited
        if today in _scan_cache:
            return _scan_cache[today]
        return _compute_scan()


def invalidate_cache() -> None:
    _scan_cache.clear()
    log.info("cointegration: cache cleared")


# ─── Background preload ───────────────────────────────────────────────────────

def _preload() -> None:
    try:
        get_cointegration_scan()
    except Exception as exc:
        log.warning("cointegration: preload failed — %s", exc)


def start_preload() -> None:
    """Start background pre-warm thread. Called from app startup."""
    threading.Thread(target=_preload, daemon=True, name="coint-preload").start()
    log.info("cointegration: background preload started")
