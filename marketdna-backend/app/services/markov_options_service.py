"""Markov Regime + Options Strategy Intelligence.

Pipeline per symbol
───────────────────
1. Fetch 3yr daily OHLCV from Parquet via DuckDB.
2. Compute ADX(14), RSI(14), SMA50, HV20 on daily bars.
3. Resample to monthly (last trading day per calendar month).
4. Classify each month into one of 6 regimes.
5. Build 6×6 Markov transition matrix; blend with NSE long-run prior.
6. Forecast next-month probability vector from current state.
7. Map dominant forecast regime to options strategy.
"""
import logging
from datetime import date as _date, datetime
from collections import defaultdict

import numpy as np

from app.services.duckdb_client import get_connection
from app.models.markov_options import (
    REGIMES,
    RegimeMonth, TransitionMatrix, OptionsStrategy,
    RegimeForecast, MarkovOptionsResult,
    MarketRegimeItem, MarketMarkovResult,
)

log = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

REGIME_IDX: dict[str, int] = {r: i for i, r in enumerate(REGIMES)}

# NSE long-run base rates (prior row, repeated for each source state)
_PRIOR = np.array([0.20, 0.08, 0.25, 0.10, 0.25, 0.12], dtype=float)
_ALPHA = 0.20   # weight on prior vs observed

_STRATEGY_MAP: dict[str, dict] = {
    "Strong Uptrend": {
        "primary":      "Bull Call Spread",
        "alternatives": ["Short Put (CSP)", "Call Debit Spread"],
        "avoid":        ["Long Put", "Bear Put Spread", "Short Strangle"],
        "rationale":    "Strong directional trend with controlled volatility. Sell premium with bull bias or take capped directional exposure.",
        "iv_action":    "Sell",
    },
    "Volatile Bull": {
        "primary":      "Long Call",
        "alternatives": ["Call Debit Spread", "Call Ratio Backspread"],
        "avoid":        ["Short Strangle", "Iron Condor", "Naked Short Put"],
        "rationale":    "Price trending up but IV elevated. Buy directional optionality — avoid selling premium into expanding volatility.",
        "iv_action":    "Buy",
    },
    "Sideways Quiet": {
        "primary":      "Iron Condor",
        "alternatives": ["Short Strangle", "Calendar Spread"],
        "avoid":        ["Long Straddle", "Long Strangle", "Debit Spreads"],
        "rationale":    "Range-bound with low volatility. Collect premium from both sides with defined-risk strikes.",
        "iv_action":    "Sell",
    },
    "Sideways Volatile": {
        "primary":      "Long Straddle",
        "alternatives": ["Long Strangle", "ATM Debit Spread"],
        "avoid":        ["Short Strangle", "Iron Condor", "Naked Short Calls/Puts"],
        "rationale":    "Choppy price action with elevated IV — breakout likely but direction unclear. Buy vol before the move.",
        "iv_action":    "Buy",
    },
    "Steady Bear": {
        "primary":      "Bear Put Spread",
        "alternatives": ["Short Call (OTM)", "Put Debit Spread"],
        "avoid":        ["Long Call", "Bull Call Spread", "Short Put CSP"],
        "rationale":    "Controlled decline with stable volatility. Directional put structure captures downside with defined risk.",
        "iv_action":    "Sell",
    },
    "Volatile Bear": {
        "primary":      "Long Put",
        "alternatives": ["Put Debit Spread", "Bear Ratio Backspread"],
        "avoid":        ["Short Strangle", "Iron Condor", "Naked Short Put"],
        "rationale":    "Sharp decline with elevated IV. Buy directional protection — avoid selling premium into fear spikes.",
        "iv_action":    "Buy",
    },
}

# Module-level result cache: (symbol, date_str) → MarkovOptionsResult
_cache: dict[tuple[str, str], MarkovOptionsResult] = {}
_market_cache: tuple[str, MarketMarkovResult] | None = None


# ─── Technical indicators (daily) ─────────────────────────────────────────────

def _compute_adx(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> np.ndarray:
    n = len(closes)
    tr     = np.zeros(n)
    pdm    = np.zeros(n)
    mdm    = np.zeros(n)

    for i in range(1, n):
        hl  = highs[i] - lows[i]
        hpc = abs(highs[i] - closes[i - 1])
        lpc = abs(lows[i]  - closes[i - 1])
        tr[i] = max(hl, hpc, lpc)
        up = highs[i] - highs[i - 1]
        dn = lows[i - 1] - lows[i]
        pdm[i] = up if up > dn and up > 0 else 0.0
        mdm[i] = dn if dn > up and dn > 0 else 0.0

    def _wilder(arr: np.ndarray, p: int) -> np.ndarray:
        s = np.zeros(n)
        if p < n:
            s[p] = arr[1 : p + 1].sum()
            for i in range(p + 1, n):
                s[i] = s[i - 1] - s[i - 1] / p + arr[i]
        return s

    atr  = _wilder(tr,  period)
    pdi  = 100 * _wilder(pdm, period) / (atr + 1e-9)
    mdi  = 100 * _wilder(mdm, period) / (atr + 1e-9)
    dx   = 100 * np.abs(pdi - mdi) / (pdi + mdi + 1e-9)
    return _wilder(dx, period)


def _compute_rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    n = len(closes)
    rsi = np.full(n, 50.0)
    if n <= period:
        return rsi
    deltas = np.diff(closes)
    gains  = np.maximum(deltas, 0.0)
    losses = np.maximum(-deltas, 0.0)
    ag = float(gains[:period].mean())
    al = float(losses[:period].mean())
    # seed bar `period` before the Wilder loop
    rs = ag / (al + 1e-9)
    rsi[period] = 100.0 - 100.0 / (1.0 + rs)
    for i in range(period, n - 1):
        ag = (ag * (period - 1) + gains[i]) / period
        al = (al * (period - 1) + losses[i]) / period
        rs = ag / (al + 1e-9)
        rsi[i + 1] = 100.0 - 100.0 / (1.0 + rs)
    return rsi


def _compute_sma(closes: np.ndarray, period: int = 50) -> np.ndarray:
    sma = np.full(len(closes), np.nan)
    for i in range(period - 1, len(closes)):
        sma[i] = closes[i - period + 1 : i + 1].mean()
    return sma


def _compute_hv20(closes: np.ndarray) -> np.ndarray:
    """20-day annualised historical volatility from log returns."""
    n = len(closes)
    hv = np.full(n, np.nan)
    log_ret = np.diff(np.log(closes + 1e-9))
    for i in range(20, n):
        hv[i] = float(log_ret[i - 20 : i].std() * np.sqrt(252) * 100)
    return hv


# ─── Monthly resampling ────────────────────────────────────────────────────────

def _resample_monthly(
    closes: np.ndarray,
    adx: np.ndarray,
    rsi: np.ndarray,
    sma50: np.ndarray,
    hv20: np.ndarray,
    dates: list[str],
) -> list[dict]:
    """Return one record per calendar month (last trading day)."""
    monthly: dict[str, list[int]] = defaultdict(list)
    for i, d in enumerate(dates):
        key = d[:7]   # "YYYY-MM"
        monthly[key].append(i)

    records = []
    keys = sorted(monthly.keys())
    for ki, key in enumerate(keys):
        idxs = monthly[key]
        last = idxs[-1]
        first = idxs[0]
        if np.isnan(adx[last]) or np.isnan(sma50[last]) or np.isnan(hv20[last]):
            continue
        if sma50[last] <= 0:
            continue
        monthly_ret = (closes[last] - closes[first]) / (closes[first] + 1e-9) * 100
        pct_vs_sma50 = (closes[last] - sma50[last]) / sma50[last] * 100
        records.append({
            "month":        key,
            "close":        float(closes[last]),
            "adx":          float(adx[last]),
            "rsi":          float(rsi[last]),
            "pct_vs_sma50": float(pct_vs_sma50),
            "monthly_ret":  float(monthly_ret),
            "hv20":         float(hv20[last]),
        })
    return records


# ─── 6-Regime Classifier ──────────────────────────────────────────────────────

def _classify(adx: float, rsi: float, pct: float, ret: float, hv_ratio: float) -> str:
    """
    2-of-3 directional scoring × volatility axis → 6 regimes.

    Bull signals : RSI≥55, price>SMA50+1.5%, monthly ret>1%
    Bear signals : RSI≤45, price<SMA50-1.5%, monthly ret<-1%
    High vol     : HV20 > median HV20 × 1.20
    Direction classified only when actual return sign agrees.
    """
    high_vol = hv_ratio >= 1.20

    bull = int(rsi >= 55) + int(pct >= 1.5) + int(ret > 1.0)
    bear = int(rsi <= 45) + int(pct <= -1.5) + int(ret < -1.0)

    if bull >= 2 and ret > 0 and not high_vol:
        return "Strong Uptrend"
    if bull >= 2 and ret > 0 and high_vol:
        return "Volatile Bull"
    if bear >= 2 and ret < 0 and not high_vol:
        return "Steady Bear"
    if bear >= 2 and ret < 0 and high_vol:
        return "Volatile Bear"
    if high_vol:
        return "Sideways Volatile"
    return "Sideways Quiet"


# ─── Markov Matrix ────────────────────────────────────────────────────────────

def _build_matrix(labels: list[str]) -> tuple[np.ndarray, np.ndarray]:
    """Return (blended_prob_matrix, raw_count_matrix) both 6×6."""
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

    # Rows with zero observations use pure prior
    zero_rows = (row_sums.flatten() == 0)
    blended[zero_rows] = _PRIOR

    return blended, counts


# ─── Core computation ─────────────────────────────────────────────────────────

def _compute_symbol(symbol: str) -> MarkovOptionsResult:
    today = _date.today().isoformat()
    cache_key = (symbol, today)
    if cache_key in _cache:
        return _cache[cache_key]

    con = get_connection()
    rows = con.execute("""
        SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)), close, high, low, volume
        FROM equities_prices
        WHERE symbol = ?
        ORDER BY date DESC
        LIMIT 2000
    """, [symbol]).fetchall()
    rows = list(reversed(rows))

    if len(rows) < 100:
        raise ValueError(f"Insufficient data for {symbol}: only {len(rows)} bars")

    dates  = [r[0] for r in rows]
    closes = np.array([r[1] for r in rows], dtype=float)
    highs  = np.array([r[2] for r in rows], dtype=float)
    lows   = np.array([r[3] for r in rows], dtype=float)

    adx   = _compute_adx(highs, lows, closes)
    rsi   = _compute_rsi(closes)
    sma50 = _compute_sma(closes, 50)
    hv20  = _compute_hv20(closes)

    monthly_recs = _resample_monthly(closes, adx, rsi, sma50, hv20, dates)
    if len(monthly_recs) < 6:
        raise ValueError(f"Insufficient monthly bars for {symbol}: {len(monthly_recs)}")

    # HV ratio = month HV20 / median HV20 over all months
    all_hv = [r["hv20"] for r in monthly_recs]
    median_hv = float(np.median(all_hv)) if all_hv else 1.0
    if median_hv < 1e-6:
        median_hv = 1.0

    history: list[RegimeMonth] = []
    labels: list[str] = []
    for rec in monthly_recs:
        hv_ratio = rec["hv20"] / median_hv
        regime   = _classify(rec["adx"], rec["rsi"], rec["pct_vs_sma50"], rec["monthly_ret"], hv_ratio)
        labels.append(regime)
        history.append(RegimeMonth(
            month        = rec["month"],
            regime       = regime,
            adx          = round(rec["adx"], 1),
            rsi          = round(rec["rsi"], 1),
            pct_vs_sma50 = round(rec["pct_vs_sma50"], 2),
            monthly_ret  = round(rec["monthly_ret"], 2),
            hv_ratio     = round(hv_ratio, 2),
        ))

    blended, counts = _build_matrix(labels)

    matrix_model = TransitionMatrix(
        regimes = REGIMES,
        matrix  = [[round(blended[i, j], 4) for j in range(6)] for i in range(6)],
        counts  = [[int(counts[i, j]) for j in range(6)] for i in range(6)],
    )

    # Forecast from current state
    current_regime = labels[-1]
    curr_idx       = REGIME_IDX[current_regime]
    state_vec      = np.zeros(6)
    state_vec[curr_idx] = 1.0
    next_probs = state_vec @ blended  # 1×6

    probs_dict = {REGIMES[i]: round(float(next_probs[i]), 4) for i in range(6)}
    sorted_probs = sorted(probs_dict.items(), key=lambda x: x[1], reverse=True)
    dominant_regime   = sorted_probs[0][0]
    dominant_prob     = sorted_probs[0][1]

    tail_risk_regime = None
    tail_risk_prob   = None
    if len(sorted_probs) > 1 and sorted_probs[1][1] >= 0.15:
        tail_risk_regime = sorted_probs[1][0]
        tail_risk_prob   = sorted_probs[1][1]

    strat_data = _STRATEGY_MAP[dominant_regime]
    strategy = OptionsStrategy(
        primary      = strat_data["primary"],
        alternatives = strat_data["alternatives"],
        avoid        = strat_data["avoid"],
        rationale    = strat_data["rationale"],
        iv_action    = strat_data["iv_action"],
    )

    forecast = RegimeForecast(
        current_regime       = current_regime,
        probabilities        = probs_dict,
        dominant_regime      = dominant_regime,
        dominant_probability = dominant_prob,
        tail_risk_regime     = tail_risk_regime,
        tail_risk_probability= tail_risk_prob,
        strategy             = strategy,
    )

    result = MarkovOptionsResult(
        symbol      = symbol,
        history     = history,
        matrix      = matrix_model,
        forecast    = forecast,
        n_months    = len(history),
        computed_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )

    _cache[cache_key] = result
    return result


def get_symbol(symbol: str) -> MarkovOptionsResult:
    return _compute_symbol(symbol)


def get_market() -> MarketMarkovResult:
    global _market_cache
    today = _date.today().isoformat()
    if _market_cache and _market_cache[0] == today:
        return _market_cache[1]

    con = get_connection()
    symbols = [r[0] for r in con.execute(
        "SELECT DISTINCT symbol FROM equities_prices ORDER BY symbol"
    ).fetchall()]

    items: list[MarketRegimeItem] = []
    regime_dist: dict[str, int] = {r: 0 for r in REGIMES}

    for sym in symbols:
        try:
            res = _compute_symbol(sym)
            f   = res.forecast
            regime_dist[f.current_regime] = regime_dist.get(f.current_regime, 0) + 1
            strat = _STRATEGY_MAP[f.dominant_regime]
            items.append(MarketRegimeItem(
                symbol           = sym,
                current_regime   = f.current_regime,
                dominant_next    = f.dominant_regime,
                dominant_prob    = f.dominant_probability,
                primary_strategy = strat["primary"],
                iv_action        = strat["iv_action"],
            ))
        except Exception as e:
            log.warning("markov_options: skipping %s — %s", sym, e)

    dominant_market = (
        max(regime_dist, key=lambda k: regime_dist[k])
        if any(v > 0 for v in regime_dist.values())
        else "Unknown"
    )

    result = MarketMarkovResult(
        items                  = items,
        regime_distribution    = regime_dist,
        dominant_market_regime = dominant_market,
        scanned_at             = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )
    _market_cache = (today, result)
    return result


def invalidate_cache() -> None:
    global _market_cache
    _cache.clear()
    _market_cache = None
    log.info("markov_options: cache cleared")
