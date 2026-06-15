"""Quantitative strategy engine — four modules in one shared-data pass.

Modules
───────
1. Cross-Sectional Momentum  — 12-1 month skip-one momentum ranking
2. Mean Reversion Z-Score    — Bollinger Z + RSI composite, OB/OS signals
3. Realized Volatility Rank  — HV20 percentile vs 252-day history
4. Sector Rotation           — Equal-weighted RS vs NIFTY, RRG quadrant

All four share a single bulk data fetch (one DuckDB query) to avoid
re-reading the Parquet lake multiple times.
"""
import logging
from datetime import date as _date, datetime
from collections import defaultdict

import numpy as np

from app.services.duckdb_client import get_connection
from app.models.quant_strategies import (
    MomentumItem, MomentumResult,
    MeanReversionItem, MeanReversionResult,
    VolRankItem, VolRankResult,
    SectorItem, SectorRotationResult,
    QuantScanResult,
)

log = logging.getLogger(__name__)

# ─── Sector map ───────────────────────────────────────────────────────────────

SECTORS: dict[str, list[str]] = {
    "Banking & Finance":       ["HDFCBANK","ICICIBANK","KOTAKBANK","AXISBANK","SBIN",
                                 "INDUSINDBK","BAJFINANCE","BAJAJFINSV","SHRIRAMFIN",
                                 "SBILIFE","HDFCLIFE"],
    "Information Technology":  ["TCS","INFY","HCLTECH","WIPRO","TECHM"],
    "FMCG & Consumer":         ["HINDUNILVR","ITC","BRITANNIA","NESTLEIND","TATACONSUM"],
    "Automobile":              ["MARUTI","TMPV","M&M","BAJAJ-AUTO","HEROMOTOCO","EICHERMOT"],
    "Metals & Materials":      ["TATASTEEL","JSWSTEEL","HINDALCO","COALINDIA","GRASIM"],
    "Energy & Utilities":      ["RELIANCE","NTPC","POWERGRID","ONGC","BPCL"],
    "Pharma & Healthcare":     ["SUNPHARMA","DRREDDY","CIPLA","DIVISLAB","APOLLOHOSP"],
    "Infrastructure":          ["ULTRACEMCO","LT","ADANIPORTS","ADANIENT"],
    "Consumer Discretionary":  ["ASIANPAINT","TITAN","TRENT"],
}

_SYM_TO_SECTOR: dict[str, str] = {
    sym: sec for sec, syms in SECTORS.items() for sym in syms
}


def _sector(symbol: str) -> str:
    return _SYM_TO_SECTOR.get(symbol, "Other")


# ─── Options strategy maps ────────────────────────────────────────────────────

_MOMENTUM_STRATEGY = {
    1: "Bull Call Spread",
    2: "Short Put (CSP)",
    3: "Iron Condor",
    4: "Bear Put Spread",
    5: "Long Put / Short Call",
}

_MOMENTUM_SIGNAL = {
    1: "Strong Long",
    2: "Long",
    3: "Neutral",
    4: "Avoid",
    5: "Strong Avoid",
}

_REVERSION_STRATEGY = {
    "Overbought":  "Call Credit Spread / Buy Put",
    "Near OB":     "Bear Put Spread",
    "Neutral":     "Iron Condor / Short Strangle",
    "Near OS":     "Bull Call Spread",
    "Oversold":    "Short Put (CSP) / Buy Call",
}

_VOL_STRATEGY = {
    "Very High": "Short Strangle / Iron Condor",
    "Elevated":  "Short Strangle / Calendar Spread",
    "Normal":    "Covered Call / CSP",
    "Low":       "Debit Spread / Long Options",
    "Very Low":  "Long Straddle / Strangle",
}

_VOL_IV_ACTION = {
    "Very High": "Sell",
    "Elevated":  "Sell",
    "Normal":    "Neutral",
    "Low":       "Buy",
    "Very Low":  "Buy",
}


# ─── Shared data fetch ────────────────────────────────────────────────────────

def _fetch_all(limit: int = 300) -> dict[str, tuple[np.ndarray, list[str]]]:
    """One DuckDB query → {symbol: (closes_array, dates_list)} newest-last."""
    con = get_connection()
    rows = con.execute("""
        SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)), close
        FROM (
            SELECT symbol, date, close,
                   ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
            FROM equities_prices
        ) t
        WHERE rn <= ?
        ORDER BY symbol, date ASC
    """, [limit]).fetchall()

    raw: dict[str, tuple[list[str], list[float]]] = {}
    for sym, dt, close in rows:
        if sym not in raw:
            raw[sym] = ([], [])
        raw[sym][0].append(dt)
        raw[sym][1].append(float(close))

    return {
        sym: (np.array(closes, dtype=float), dates)
        for sym, (dates, closes) in raw.items()
        if len(closes) >= 60
    }


# ─── RSI helper (Wilder smoothing) ───────────────────────────────────────────

def _rsi(closes: np.ndarray, period: int = 14) -> float:
    """Return the most recent RSI value."""
    if len(closes) <= period:
        return 50.0
    deltas = np.diff(closes[-period * 3:])
    gains  = np.maximum(deltas, 0.0)
    losses = np.maximum(-deltas, 0.0)
    ag = float(gains[:period].mean())
    al = float(losses[:period].mean())
    for i in range(period, len(gains)):
        ag = (ag * (period - 1) + gains[i]) / period
        al = (al * (period - 1) + losses[i]) / period
    return round(100.0 - 100.0 / (1.0 + ag / (al + 1e-9)), 1)


# ─── HV20 helper ─────────────────────────────────────────────────────────────

def _hv20_series(closes: np.ndarray) -> np.ndarray:
    """Return array of annualised 20-day HV % values (nan for first 20 bars).
    Uses ddof=1 (sample std) — the standard realized-vol formula."""
    n = len(closes)
    hv = np.full(n, np.nan)
    log_ret = np.diff(np.log(closes + 1e-9))
    for i in range(20, n):
        hv[i] = log_ret[i - 20: i].std(ddof=1) * np.sqrt(252) * 100
    return hv


# ─── 1. Cross-Sectional Momentum ─────────────────────────────────────────────

def _compute_momentum(data: dict[str, tuple[np.ndarray, list[str]]]) -> MomentumResult:
    BARS_1M  = 22
    BARS_3M  = 66
    BARS_12M = 252

    records: list[dict] = []
    for sym, (closes, _) in data.items():
        n = len(closes)
        if n < BARS_12M + BARS_1M:
            continue
        c_now   = closes[-1]
        c_1m    = closes[-BARS_1M]
        c_3m    = closes[-BARS_3M] if n >= BARS_3M else closes[0]
        c_12m   = closes[-BARS_12M] if n >= BARS_12M else closes[0]
        # 12-1 skip-one: return from 12m ago to 1m ago
        ret_12_1 = (c_1m - c_12m) / (c_12m + 1e-9) * 100
        ret_3m   = (c_now - c_3m)  / (c_3m  + 1e-9) * 100
        ret_1m   = (c_now - c_1m)  / (c_1m  + 1e-9) * 100
        records.append({
            "symbol": sym, "sector": _sector(sym),
            "ret_12_1m": round(ret_12_1, 2),
            "ret_3m":    round(ret_3m, 2),
            "ret_1m":    round(ret_1m, 2),
        })

    if not records:
        return MomentumResult(items=[], top_5=[], bottom_5=[],
                              as_of=datetime.utcnow().strftime("%Y-%m-%d"))

    # Sort by 12-1 return descending, assign rank + quintile
    records.sort(key=lambda x: x["ret_12_1m"], reverse=True)
    n_total = len(records)
    items: list[MomentumItem] = []
    for i, r in enumerate(records):
        rank     = i + 1
        quintile = min(5, int(i / n_total * 5) + 1)
        items.append(MomentumItem(
            symbol           = r["symbol"],
            sector           = r["sector"],
            ret_12_1m        = r["ret_12_1m"],
            ret_3m           = r["ret_3m"],
            ret_1m           = r["ret_1m"],
            rank             = rank,
            quintile         = quintile,
            signal           = _MOMENTUM_SIGNAL[quintile],
            options_strategy = _MOMENTUM_STRATEGY[quintile],
        ))

    top_5    = [x.symbol for x in items[:5]]
    bottom_5 = [x.symbol for x in items[-5:]]
    return MomentumResult(
        items    = items,
        top_5    = top_5,
        bottom_5 = bottom_5,
        as_of    = datetime.utcnow().strftime("%Y-%m-%d"),
    )


# ─── 2. Mean Reversion Z-Score ────────────────────────────────────────────────

def _classify_reversion(score: float) -> str:
    if score >= 1.5:   return "Overbought"
    if score >= 0.75:  return "Near OB"
    if score <= -1.5:  return "Oversold"
    if score <= -0.75: return "Near OS"
    return "Neutral"


def _compute_mean_reversion(data: dict[str, tuple[np.ndarray, list[str]]]) -> MeanReversionResult:
    items: list[MeanReversionItem] = []

    for sym, (closes, _) in data.items():
        if len(closes) < 55:
            continue

        # Z-score 20d
        sma20 = closes[-20:].mean()
        std20 = closes[-20:].std() + 1e-9
        z20   = (closes[-1] - sma20) / std20

        # Z-score 50d
        sma50 = closes[-50:].mean()
        std50 = closes[-50:].std() + 1e-9
        z50   = (closes[-1] - sma50) / std50

        # Bollinger %B (SMA20 ± 2σ)
        upper = sma20 + 2 * std20
        lower = sma20 - 2 * std20
        pct_b = (closes[-1] - lower) / (upper - lower + 1e-9)

        rsi_val = _rsi(closes)

        # Composite score: Z-scores + RSI deviation from 50
        rsi_z = (rsi_val - 50.0) / 15.0   # scale to ~[-3, +3]
        score = round(0.4 * z20 + 0.3 * z50 + 0.3 * rsi_z, 3)

        signal   = _classify_reversion(score)
        strategy = _REVERSION_STRATEGY[signal]

        items.append(MeanReversionItem(
            symbol           = sym,
            sector           = _sector(sym),
            z_score_20d      = round(z20, 3),
            z_score_50d      = round(z50, 3),
            bb_pct_b         = round(float(np.clip(pct_b, -0.5, 1.5)), 3),
            rsi              = rsi_val,
            reversion_score  = score,
            signal           = signal,
            options_strategy = strategy,
        ))

    # Sort: most overbought first, then oversold at bottom
    items.sort(key=lambda x: x.reversion_score, reverse=True)
    overbought = [x.symbol for x in items if x.signal == "Overbought"]
    oversold   = [x.symbol for x in items if x.signal == "Oversold"]

    return MeanReversionResult(
        items      = items,
        overbought = overbought,
        oversold   = oversold,
        as_of      = datetime.utcnow().strftime("%Y-%m-%d"),
    )


# ─── 3. Realized Volatility Rank ─────────────────────────────────────────────

def _vol_regime(rank: float) -> str:
    if rank >= 80: return "Very High"
    if rank >= 60: return "Elevated"
    if rank >= 40: return "Normal"
    if rank >= 20: return "Low"
    return "Very Low"


def _compute_vol_rank(data: dict[str, tuple[np.ndarray, list[str]]]) -> VolRankResult:
    items: list[VolRankItem] = []

    for sym, (closes, _) in data.items():
        if len(closes) < 252 + 20:
            continue

        hv_series = _hv20_series(closes)
        # Use last 252 bars of HV values for the ranking window
        hv_window = hv_series[-252:]
        valid     = hv_window[~np.isnan(hv_window)]
        if len(valid) < 20:
            continue

        hv_current = float(hv_series[-1])
        hv_1m_ago  = float(hv_series[-22]) if not np.isnan(hv_series[-22]) else hv_current

        hv_rank = float(np.sum(valid <= hv_current) / len(valid) * 100)

        diff = hv_current - hv_1m_ago
        vol_trend = "Rising" if diff > 1.0 else "Falling" if diff < -1.0 else "Stable"

        regime   = _vol_regime(hv_rank)
        strategy = _VOL_STRATEGY[regime]
        iv_action= _VOL_IV_ACTION[regime]

        items.append(VolRankItem(
            symbol           = sym,
            sector           = _sector(sym),
            hv20             = round(hv_current, 1),
            hv20_1m_ago      = round(hv_1m_ago, 1),
            hv_rank          = round(hv_rank, 1),
            vol_trend        = vol_trend,
            regime           = regime,
            options_strategy = strategy,
            iv_action        = iv_action,
        ))

    items.sort(key=lambda x: x.hv_rank, reverse=True)
    sell_candidates = [x.symbol for x in items if x.hv_rank >= 70]
    buy_candidates  = [x.symbol for x in items if x.hv_rank <= 30]

    return VolRankResult(
        items           = items,
        sell_candidates = sell_candidates,
        buy_candidates  = buy_candidates,
        as_of           = datetime.utcnow().strftime("%Y-%m-%d"),
    )


# ─── 4. Sector Relative Strength Rotation ────────────────────────────────────

def _rrg_phase(rs_3m: float, rs_1m: float) -> str:
    """RRG quadrant: RS level (3M) × RS momentum (1M vs implied monthly rate).

    Comparing rs_1m directly to rs_3m mixes time horizons.
    rs_3m / 3 gives the average monthly RS implied by the 3-month window,
    so rs_1m > rs_3m/3 means the most recent month is above that average —
    i.e. momentum is accelerating.
    """
    avg_monthly_rs   = rs_3m / 3.0          # implied monthly RS from 3M window
    improving_moment = rs_1m > avg_monthly_rs

    if rs_3m >= 0 and improving_moment:
        return "Leading"
    if rs_3m >= 0 and not improving_moment:
        return "Weakening"
    if rs_3m < 0 and improving_moment:
        return "Improving"
    return "Lagging"


def _compute_sector_rotation(data: dict[str, tuple[np.ndarray, list[str]]]) -> SectorRotationResult:
    BARS_1M = 22
    BARS_3M = 66

    # Compute per-symbol returns
    sym_ret: dict[str, tuple[float, float]] = {}
    for sym, (closes, _) in data.items():
        if len(closes) < BARS_3M:
            continue
        r1m = (closes[-1] - closes[-BARS_1M]) / (closes[-BARS_1M] + 1e-9) * 100
        r3m = (closes[-1] - closes[-BARS_3M]) / (closes[-BARS_3M] + 1e-9) * 100
        sym_ret[sym] = (round(r1m, 2), round(r3m, 2))

    if not sym_ret:
        return SectorRotationResult(sectors=[], nifty_ret_1m=0.0, nifty_ret_3m=0.0,
                                    leading=[], improving=[], weakening=[], lagging=[],
                                    as_of=datetime.utcnow().strftime("%Y-%m-%d"))

    # NIFTY proxy = equal-weighted average of all available symbols
    all_r1 = [v[0] for v in sym_ret.values()]
    all_r3 = [v[1] for v in sym_ret.values()]
    nifty_1m = float(np.mean(all_r1))
    nifty_3m = float(np.mean(all_r3))

    sector_items: list[SectorItem] = []
    for sector, syms in SECTORS.items():
        available = [s for s in syms if s in sym_ret]
        if not available:
            continue
        r1_vals = [sym_ret[s][0] for s in available]
        r3_vals = [sym_ret[s][1] for s in available]
        r1m = round(float(np.mean(r1_vals)), 2)
        r3m = round(float(np.mean(r3_vals)), 2)
        rs_1m = round(r1m - nifty_1m, 2)
        rs_3m = round(r3m - nifty_3m, 2)
        sector_items.append(SectorItem(
            sector   = sector,
            symbols  = available,
            n_stocks = len(available),
            ret_1m   = r1m,
            ret_3m   = r3m,
            rs_1m    = rs_1m,
            rs_3m    = rs_3m,
            rank_3m  = 0,   # filled below
            phase    = _rrg_phase(rs_3m, rs_1m),
        ))

    # Rank by 3M RS
    sector_items.sort(key=lambda x: x.rs_3m, reverse=True)
    for i, s in enumerate(sector_items):
        s.rank_3m = i + 1

    return SectorRotationResult(
        sectors      = sector_items,
        nifty_ret_1m = round(nifty_1m, 2),
        nifty_ret_3m = round(nifty_3m, 2),
        leading      = [s.sector for s in sector_items if s.phase == "Leading"],
        improving    = [s.sector for s in sector_items if s.phase == "Improving"],
        weakening    = [s.sector for s in sector_items if s.phase == "Weakening"],
        lagging      = [s.sector for s in sector_items if s.phase == "Lagging"],
        as_of        = datetime.utcnow().strftime("%Y-%m-%d"),
    )


# ─── Combined scan (one data fetch for all 4) ────────────────────────────────

_cache: tuple[str, QuantScanResult] | None = None


def run_scan() -> QuantScanResult:
    global _cache
    today = _date.today().isoformat()
    if _cache and _cache[0] == today:
        return _cache[1]

    log.info("quant_strategies: fetching data…")
    data = _fetch_all(limit=300)
    log.info("quant_strategies: %d symbols loaded, computing…", len(data))

    result = QuantScanResult(
        momentum        = _compute_momentum(data),
        mean_reversion  = _compute_mean_reversion(data),
        vol_rank        = _compute_vol_rank(data),
        sector_rotation = _compute_sector_rotation(data),
        computed_at     = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )
    _cache = (today, result)
    log.info("quant_strategies: scan complete")
    return result


def invalidate_cache() -> None:
    global _cache
    _cache = None
    log.info("quant_strategies: cache cleared")
