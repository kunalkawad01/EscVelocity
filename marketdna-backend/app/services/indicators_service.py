"""Technical Indicator Analysis Engine.

Per-symbol indicators (last 300 daily bars):
  Trend      : SMA(20,50,100,200), EMA(20,50)
  Momentum   : RSI(14), MACD(12,26,9), Stochastic(14,3,3)
  Volatility : Bollinger Bands(20,2), ATR(14)
  Volume     : OBV, Volume ratio vs SMA(20)
"""
import logging
from collections import defaultdict
from datetime import date as _date, datetime

import numpy as np
from scipy.signal import lfilter, lfilter_zi

from app.services.duckdb_client import get_connection
from app.models.indicators import (
    TrendReading, MomentumReading, VolatilityReading, VolumeReading,
    IndicatorDivergence, StockIndicators,
    IndicatorScanItem, IndicatorScanResult,
)

log = logging.getLogger(__name__)

# ─── Module-level cache ────────────────────────────────────────────────────────

_symbol_cache: dict[tuple[str, str], StockIndicators] = {}
_scan_cache:   tuple[str, IndicatorScanResult] | None = None


# ─── Indicator functions ───────────────────────────────────────────────────────

def _sma(closes: np.ndarray, period: int) -> np.ndarray:
    n = len(closes)
    out = np.full(n, np.nan)
    if n < period:
        return out
    cs = np.concatenate([[0.0], np.cumsum(closes)])
    out[period - 1:] = (cs[period:] - cs[:n - period + 1]) / period
    return out


def _ema(closes: np.ndarray, period: int) -> np.ndarray:
    n = len(closes)
    out = np.full(n, np.nan)
    if n < period:
        return out
    alpha = 2.0 / (period + 1)
    seed = float(closes[:period].mean())
    out[period - 1] = seed
    if n > period:
        b = [alpha]
        a = [1.0, -(1.0 - alpha)]
        zi = lfilter_zi(b, a) * seed
        out[period:], _ = lfilter(b, a, closes[period:], zi=zi)
    return out


def _rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    n = len(closes)
    out = np.full(n, 50.0)
    if n <= period:
        return out
    deltas = np.diff(closes)
    gains  = np.maximum(deltas, 0.0)
    losses = np.maximum(-deltas, 0.0)
    # Wilder's smoothing = EMA with alpha = 1/period
    alpha = 1.0 / period
    b = [alpha]
    a = [1.0, -(1.0 - alpha)]
    seed_g = float(gains[:period].mean())
    seed_l = float(losses[:period].mean())
    out[period] = 100.0 - 100.0 / (1.0 + seed_g / (seed_l + 1e-9))
    if n > period + 1:
        zi_g = lfilter_zi(b, a) * seed_g
        zi_l = lfilter_zi(b, a) * seed_l
        ag, _ = lfilter(b, a, gains[period:], zi=zi_g)
        al, _ = lfilter(b, a, losses[period:], zi=zi_l)
        out[period + 1:] = 100.0 - 100.0 / (1.0 + ag / (al + 1e-9))
    return out


def _macd(closes: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (macd_line, signal_line, histogram). Valid from bar ~33 onward."""
    ema12 = _ema(closes, 12)
    ema26 = _ema(closes, 26)
    line  = ema12 - ema26           # valid from index 25 (ema26 seed bar)

    sig = np.full(len(closes), np.nan)
    first = 25                      # first valid MACD index
    if len(closes) >= first + 9:
        sig[first:] = _ema(line[first:], 9)

    return line, sig, line - sig


def _stochastic(
    highs: np.ndarray, lows: np.ndarray, closes: np.ndarray,
    k_period: int = 14, d_period: int = 3,
) -> tuple[np.ndarray, np.ndarray]:
    n = len(closes)
    stoch_k = np.full(n, np.nan)
    stoch_d = np.full(n, np.nan)
    if n < k_period:
        return stoch_k, stoch_d
    # Vectorised rolling max/min via sliding_window_view (NumPy ≥ 1.20)
    roll_hi = np.lib.stride_tricks.sliding_window_view(highs, k_period).max(axis=1)
    roll_lo = np.lib.stride_tricks.sliding_window_view(lows,  k_period).min(axis=1)
    k_vals = (closes[k_period - 1:] - roll_lo) / (roll_hi - roll_lo + 1e-9) * 100
    stoch_k[k_period - 1:] = k_vals
    # D: rolling mean of K over d_period
    m = len(k_vals)
    if m >= d_period:
        cs = np.concatenate([[0.0], np.cumsum(k_vals)])
        d_vals = (cs[d_period:] - cs[:m - d_period + 1]) / d_period
        stoch_d[k_period + d_period - 2:] = d_vals
    return stoch_k, stoch_d


def _atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> np.ndarray:
    n = len(closes)
    tr = np.zeros(n)
    if n > 1:
        tr[1:] = np.maximum(
            highs[1:] - lows[1:],
            np.maximum(
                np.abs(highs[1:] - closes[:-1]),
                np.abs(lows[1:]  - closes[:-1]),
            ),
        )
    out = np.full(n, np.nan)
    if n > period:
        seed = float(tr[1 : period + 1].mean())
        out[period] = seed
        if n > period + 1:
            alpha = 1.0 / period
            b = [alpha]
            a = [1.0, -(1.0 - alpha)]
            zi = lfilter_zi(b, a) * seed
            out[period + 1:], _ = lfilter(b, a, tr[period + 1:], zi=zi)
    return out


def _bollinger(closes: np.ndarray, period: int = 20, num_std: float = 2.0) -> tuple[
    np.ndarray, np.ndarray, np.ndarray, np.ndarray
]:
    n = len(closes)
    upper = np.full(n, np.nan)
    mid   = np.full(n, np.nan)
    lower = np.full(n, np.nan)
    pct_b = np.full(n, np.nan)
    if n < period:
        return upper, mid, lower, pct_b
    # Vectorised rolling mean/std via cumsum (avoids O(n × period) Python loop)
    cs  = np.concatenate([[0.0], np.cumsum(closes)])
    cs2 = np.concatenate([[0.0], np.cumsum(closes ** 2)])
    roll_mean  = (cs[period:]  - cs[:n - period + 1])  / period
    roll_mean2 = (cs2[period:] - cs2[:n - period + 1]) / period
    roll_std   = np.sqrt(np.maximum((roll_mean2 - roll_mean ** 2) * period / (period - 1), 0.0))
    mid[period - 1:]   = roll_mean
    upper[period - 1:] = roll_mean + num_std * roll_std
    lower[period - 1:] = roll_mean - num_std * roll_std
    bw = upper[period - 1:] - lower[period - 1:]
    pct_b[period - 1:] = np.where(bw > 0, (closes[period - 1:] - lower[period - 1:]) / bw * 100, np.nan)
    return upper, mid, lower, pct_b


def _obv(closes: np.ndarray, volumes: np.ndarray) -> np.ndarray:
    direction = np.sign(np.diff(closes))           # +1 up, 0 flat, -1 down
    signed_vol = np.concatenate([[0.0], direction * volumes[1:]])
    return np.cumsum(signed_vol)


# ─── Signal classifiers ────────────────────────────────────────────────────────

def _rsi_signal(v: float) -> str:
    if v < 30: return "Oversold"
    if v < 40: return "Near Oversold"
    if v < 60: return "Neutral"
    if v < 70: return "Near Overbought"
    return "Overbought"


def _macd_crossover(prev_h: float, curr_h: float) -> str:
    if np.isnan(prev_h) or np.isnan(curr_h):
        return "None"
    if prev_h < 0 and curr_h >= 0:
        return "Bullish"
    if prev_h > 0 and curr_h <= 0:
        return "Bearish"
    return "None"


def _bb_signal(pct_b: float) -> str:
    if pct_b < 10:  return "Below Lower Band"
    if pct_b < 30:  return "Near Lower Band"
    if pct_b < 70:  return "Mid Band"
    if pct_b < 90:  return "Near Upper Band"
    return "Above Upper Band"


def _stoch_signal(k: float, d: float) -> str:
    if k > 80 and d > 80: return "Overbought"
    if k < 20 and d < 20: return "Oversold"
    return "Neutral"


def _trend_label(score: int) -> str:
    if score == 4: return "Fully Bullish"
    if score == 3: return "Mostly Bullish"
    if score == 2: return "Mixed"
    if score == 1: return "Mostly Bearish"
    return "Fully Bearish"


def _vol_signal(ratio: float) -> str:
    if ratio > 2.0:  return "High Volume"
    if ratio < 0.5:  return "Low Volume"
    return "Normal"


def _overall_signal(
    rsi_v: float,
    macd_h_curr: float,
    macd_h_prev: float,
    pct_b: float,
    stoch_k: float,
    stoch_d: float,
) -> tuple[str, float]:
    score = 0.0

    if rsi_v < 30:         score += 1.0
    elif rsi_v < 40:       score += 0.5
    elif rsi_v > 70:       score -= 1.0
    elif rsi_v > 60:       score -= 0.5

    cross = _macd_crossover(macd_h_prev, macd_h_curr)
    if cross == "Bullish":       score += 1.0
    elif cross == "Bearish":     score -= 1.0
    elif not np.isnan(macd_h_curr):
        score += 0.3 if macd_h_curr > 0 else -0.3

    if not np.isnan(pct_b):
        if pct_b < 10:     score += 1.0
        elif pct_b < 30:   score += 0.4
        elif pct_b > 90:   score -= 1.0
        elif pct_b > 70:   score -= 0.4

    if not (np.isnan(stoch_k) or np.isnan(stoch_d)):
        if stoch_k < 20 and stoch_d < 20:   score += 0.5
        elif stoch_k > 80 and stoch_d > 80: score -= 0.5

    label = (
        "Strong Buy"  if score >= 2.0  else
        "Buy"         if score >= 0.7  else
        "Neutral"     if score >= -0.7 else
        "Sell"        if score >= -2.0 else
        "Strong Sell"
    )
    return label, round(score, 2)


def _detect_divergences(
    closes: np.ndarray, rsi_arr: np.ndarray, macd_hist: np.ndarray, lookback: int = 20
) -> list[IndicatorDivergence]:
    divs: list[IndicatorDivergence] = []
    n = len(closes)
    if n < lookback + 5:
        return divs

    price_now = closes[n - 1]
    price_mid = closes[n - lookback // 2]
    rsi_now   = rsi_arr[n - 1]
    rsi_mid   = rsi_arr[n - lookback // 2]

    if price_now < price_mid and rsi_now > rsi_mid + 3:
        divs.append(IndicatorDivergence(
            type="Bullish RSI Divergence",
            description="Price making lower lows while RSI trending higher — hidden bullish strength.",
        ))
    if price_now > price_mid and rsi_now < rsi_mid - 3:
        divs.append(IndicatorDivergence(
            type="Bearish RSI Divergence",
            description="Price making higher highs while RSI declining — hidden bearish weakness.",
        ))

    # MACD bullish divergence: price lower but MACD hist improving
    half = lookback // 2
    macd_window = macd_hist[n - lookback : n]
    macd_first_half = macd_window[:half]
    macd_second_half = macd_window[half:]
    valid_first  = macd_first_half[~np.isnan(macd_first_half)]
    valid_second = macd_second_half[~np.isnan(macd_second_half)]
    if len(valid_first) >= 3 and len(valid_second) >= 3:
        if price_now < price_mid and valid_second.mean() > valid_first.mean() + 0.01:
            divs.append(IndicatorDivergence(
                type="Bullish MACD Divergence",
                description="Price lower but MACD histogram improving — momentum turning positive.",
            ))

    return divs


# ─── Main per-symbol builder ───────────────────────────────────────────────────

def _build_stock_indicators(
    symbol: str,
    closes: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    volumes: np.ndarray,
    dates: list[str],
) -> StockIndicators:
    sma20  = _sma(closes, 20)
    sma50  = _sma(closes, 50)
    sma100 = _sma(closes, 100)
    sma200 = _sma(closes, 200)
    ema20  = _ema(closes, 20)
    ema50  = _ema(closes, 50)

    rsi_arr                        = _rsi(closes)
    macd_line, macd_sig, macd_hist = _macd(closes)
    stoch_k, stoch_d               = _stochastic(highs, lows, closes)
    atr_arr                        = _atr(highs, lows, closes)
    bb_upper, bb_mid, bb_lower, pct_b = _bollinger(closes)
    obv_arr                        = _obv(closes, volumes)
    vol_sma20                      = _sma(volumes, 20)

    last  = len(closes) - 1
    price = float(closes[last])

    def _safe(arr: np.ndarray) -> float:
        v = arr[last]
        return float(v) if not np.isnan(v) else 0.0

    def _pct_diff(arr: np.ndarray) -> float:
        v = _safe(arr)
        return round((price - v) / v * 100, 2) if v != 0 else 0.0

    # Trend
    alignment = sum([
        price > _safe(sma20),
        price > _safe(sma50),
        price > _safe(sma100),
        price > _safe(sma200),
    ])
    trend = TrendReading(
        sma20           = round(_safe(sma20), 2),
        sma50           = round(_safe(sma50), 2),
        sma100          = round(_safe(sma100), 2),
        sma200          = round(_safe(sma200), 2),
        ema20           = round(_safe(ema20), 2),
        ema50           = round(_safe(ema50), 2),
        price_vs_sma20  = _pct_diff(sma20),
        price_vs_sma50  = _pct_diff(sma50),
        price_vs_sma100 = _pct_diff(sma100),
        price_vs_sma200 = _pct_diff(sma200),
        alignment_score = alignment,
        trend_label     = _trend_label(alignment),
    )

    # Momentum
    rsi_now    = _safe(rsi_arr)
    macd_h_c   = float(macd_hist[last])     if not np.isnan(macd_hist[last])     else float("nan")
    macd_h_p   = float(macd_hist[last - 1]) if last > 0 and not np.isnan(macd_hist[last - 1]) else float("nan")
    stoch_k_v  = _safe(stoch_k)
    stoch_d_v  = _safe(stoch_d)

    momentum = MomentumReading(
        rsi14          = round(rsi_now, 1),
        rsi_signal     = _rsi_signal(rsi_now),
        macd_line      = round(float(macd_line[last]) if not np.isnan(macd_line[last]) else 0.0, 4),
        macd_signal    = round(float(macd_sig[last])  if not np.isnan(macd_sig[last])  else 0.0, 4),
        macd_hist      = round(macd_h_c if not np.isnan(macd_h_c) else 0.0, 4),
        macd_crossover = _macd_crossover(macd_h_p, macd_h_c),
        stoch_k        = round(stoch_k_v, 1),
        stoch_d        = round(stoch_d_v, 1),
        stoch_signal   = _stoch_signal(stoch_k_v, stoch_d_v),
    )

    # Volatility
    pct_b_v = float(pct_b[last]) if not np.isnan(pct_b[last]) else 50.0
    atr_v   = _safe(atr_arr)
    volatility = VolatilityReading(
        bb_upper  = round(_safe(bb_upper), 2),
        bb_middle = round(_safe(bb_mid), 2),
        bb_lower  = round(_safe(bb_lower), 2),
        bb_pct_b  = round(pct_b_v, 1),
        bb_signal = _bb_signal(pct_b_v),
        atr14     = round(atr_v, 2),
        atr_pct   = round(atr_v / price * 100, 2) if price > 0 else 0.0,
    )

    # Volume
    vol_now   = float(volumes[last])
    vol_avg   = _safe(vol_sma20)
    vol_ratio = round(vol_now / (vol_avg + 1e-9), 2)
    volume = VolumeReading(
        obv          = round(float(obv_arr[last]), 0),
        volume       = round(vol_now, 0),
        volume_sma20 = round(vol_avg, 0),
        volume_ratio = vol_ratio,
        volume_signal= _vol_signal(vol_ratio),
    )

    signal_label, signal_score = _overall_signal(
        rsi_now, macd_h_c, macd_h_p, pct_b_v, stoch_k_v, stoch_d_v
    )
    divs = _detect_divergences(closes, rsi_arr, macd_hist)

    return StockIndicators(
        symbol        = symbol,
        date          = dates[last],
        price         = round(price, 2),
        trend         = trend,
        momentum      = momentum,
        volatility    = volatility,
        volume        = volume,
        divergences   = divs,
        overall_signal= signal_label,
        signal_score  = signal_score,
        computed_at   = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )


# ─── Public API ───────────────────────────────────────────────────────────────

def get_symbol(symbol: str) -> StockIndicators:
    today     = _date.today().isoformat()
    cache_key = (symbol, today)
    if cache_key in _symbol_cache:
        return _symbol_cache[cache_key]

    con  = get_connection()
    rows = con.execute("""
        SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)), close, high, low, volume
        FROM equities_prices
        WHERE symbol = ?
        ORDER BY date DESC
        LIMIT 300
    """, [symbol]).fetchall()
    rows = list(reversed(rows))

    if len(rows) < 35:
        raise ValueError(f"Insufficient data for {symbol}: only {len(rows)} bars")

    dates   = [r[0] for r in rows]
    closes  = np.array([r[1] for r in rows], dtype=float)
    highs   = np.array([r[2] for r in rows], dtype=float)
    lows    = np.array([r[3] for r in rows], dtype=float)
    volumes = np.array([r[4] for r in rows], dtype=float)

    result = _build_stock_indicators(symbol, closes, highs, lows, volumes, dates)
    _symbol_cache[cache_key] = result
    return result


def get_scan() -> IndicatorScanResult:
    global _scan_cache
    today = _date.today().isoformat()
    if _scan_cache and _scan_cache[0] == today:
        return _scan_cache[1]

    con  = get_connection()
    rows = con.execute("""
        SELECT symbol,
               STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS dt,
               close, high, low, volume
        FROM (
            SELECT symbol, date, close, high, low, volume,
                   ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
            FROM equities_prices
        ) t
        WHERE rn <= 300
        ORDER BY symbol, date ASC
    """).fetchall()

    sym_rows: dict[str, list] = defaultdict(list)
    for r in rows:
        sym_rows[r[0]].append(r[1:])

    items: list[IndicatorScanItem] = []
    signal_dist: dict[str, int] = {
        "Strong Buy": 0, "Buy": 0, "Neutral": 0, "Sell": 0, "Strong Sell": 0
    }

    for sym, sym_data in sorted(sym_rows.items()):
        try:
            dates   = [r[0] for r in sym_data]
            closes  = np.array([r[1] for r in sym_data], dtype=float)
            highs   = np.array([r[2] for r in sym_data], dtype=float)
            lows    = np.array([r[3] for r in sym_data], dtype=float)
            volumes = np.array([r[4] for r in sym_data], dtype=float)

            si = _build_stock_indicators(sym, closes, highs, lows, volumes, dates)
            _symbol_cache[(sym, today)] = si

            active: list[str] = []
            if si.momentum.rsi_signal in ("Oversold", "Near Oversold"):
                active.append(si.momentum.rsi_signal)
            if si.momentum.rsi_signal in ("Overbought", "Near Overbought"):
                active.append(si.momentum.rsi_signal)
            if si.momentum.macd_crossover != "None":
                active.append(f"MACD {si.momentum.macd_crossover}")
            if si.volatility.bb_signal in ("Below Lower Band", "Above Upper Band"):
                active.append(si.volatility.bb_signal)
            if si.volume.volume_signal == "High Volume":
                active.append("High Volume")
            active.extend(d.type for d in si.divergences)

            items.append(IndicatorScanItem(
                symbol          = sym,
                price           = si.price,
                rsi14           = si.momentum.rsi14,
                rsi_signal      = si.momentum.rsi_signal,
                macd_hist       = si.momentum.macd_hist,
                macd_crossover  = si.momentum.macd_crossover,
                bb_pct_b        = si.volatility.bb_pct_b,
                bb_signal       = si.volatility.bb_signal,
                atr_pct         = si.volatility.atr_pct,
                volume_ratio    = si.volume.volume_ratio,
                trend_label     = si.trend.trend_label,
                alignment_score = si.trend.alignment_score,
                overall_signal  = si.overall_signal,
                signal_score    = si.signal_score,
                signals         = active,
            ))
            signal_dist[si.overall_signal] = signal_dist.get(si.overall_signal, 0) + 1
        except Exception as e:
            log.warning("indicators: skipping %s — %s", sym, e)

    result = IndicatorScanResult(
        items               = items,
        signal_distribution = signal_dist,
        computed_at         = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )
    _scan_cache = (today, result)
    return result


def invalidate_cache() -> None:
    global _scan_cache
    _symbol_cache.clear()
    _scan_cache = None
    log.info("indicators: cache cleared")
