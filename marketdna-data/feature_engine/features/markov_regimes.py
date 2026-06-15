"""Monthly 6-regime Markov classification for all symbols.

Copies exact logic from markov_options_service.py so regime labels match the
live service. Always full recompute — hv_ratio depends on per-symbol median_hv
which shifts when new months arrive.
"""
import logging
import time
from collections import defaultdict

import numpy as np
import polars as pl

from feature_engine.writers.feature_writer import write_feature
from warehouse.register_views import get_connection

log = logging.getLogger(__name__)
NAME = "markov_regimes"

REGIMES = [
    "Strong Uptrend", "Volatile Bull", "Sideways Quiet",
    "Sideways Volatile", "Steady Bear", "Volatile Bear",
]


# ── Exact copies from markov_options_service.py ────────────────────────────────

def _wilder(arr: np.ndarray, p: int) -> np.ndarray:
    n = len(arr)
    s = np.zeros(n)
    if p < n:
        s[p] = arr[1: p + 1].sum()
        for i in range(p + 1, n):
            s[i] = s[i - 1] - s[i - 1] / p + arr[i]
    return s


def _compute_adx(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> np.ndarray:
    n = len(closes)
    tr  = np.zeros(n)
    pdm = np.zeros(n)
    mdm = np.zeros(n)
    for i in range(1, n):
        hl  = highs[i] - lows[i]
        hpc = abs(highs[i] - closes[i - 1])
        lpc = abs(lows[i]  - closes[i - 1])
        tr[i] = max(hl, hpc, lpc)
        up = highs[i] - highs[i - 1]
        dn = lows[i - 1] - lows[i]
        pdm[i] = up if up > dn and up > 0 else 0.0
        mdm[i] = dn if dn > up and dn > 0 else 0.0
    atr = _wilder(tr,  period)
    pdi = 100 * _wilder(pdm, period) / (atr + 1e-9)
    mdi = 100 * _wilder(mdm, period) / (atr + 1e-9)
    dx  = 100 * np.abs(pdi - mdi) / (pdi + mdi + 1e-9)
    return _wilder(dx, period)


def _compute_rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    n = len(closes)
    result = np.full(n, 50.0)
    if n <= period:
        return result
    deltas = np.diff(closes)
    gains  = np.maximum(deltas, 0.0)
    losses = np.maximum(-deltas, 0.0)
    ag = float(gains[:period].mean())
    al = float(losses[:period].mean())
    rs = ag / (al + 1e-9)
    result[period] = 100.0 - 100.0 / (1.0 + rs)
    for i in range(period, n - 1):
        ag = (ag * (period - 1) + gains[i]) / period
        al = (al * (period - 1) + losses[i]) / period
        rs = ag / (al + 1e-9)
        result[i + 1] = 100.0 - 100.0 / (1.0 + rs)
    return result


def _compute_sma(closes: np.ndarray, period: int = 50) -> np.ndarray:
    result = np.full(len(closes), np.nan)
    for i in range(period - 1, len(closes)):
        result[i] = closes[i - period + 1: i + 1].mean()
    return result


def _compute_hv20(closes: np.ndarray) -> np.ndarray:
    n = len(closes)
    hv = np.full(n, np.nan)
    log_ret = np.diff(np.log(closes + 1e-9))
    for i in range(20, n):
        hv[i] = float(log_ret[i - 20: i].std() * np.sqrt(252) * 100)
    return hv


def _resample_monthly(
    closes: np.ndarray,
    adx: np.ndarray,
    rsi_arr: np.ndarray,
    sma50: np.ndarray,
    hv20: np.ndarray,
    dates: list[str],
) -> list[dict]:
    monthly: dict[str, list[int]] = defaultdict(list)
    for i, d in enumerate(dates):
        monthly[d[:7]].append(i)
    records = []
    for key in sorted(monthly.keys()):
        idxs = monthly[key]
        last  = idxs[-1]
        first = idxs[0]
        if np.isnan(adx[last]) or np.isnan(sma50[last]) or np.isnan(hv20[last]):
            continue
        if sma50[last] <= 0:
            continue
        monthly_ret  = (closes[last] - closes[first]) / (closes[first] + 1e-9) * 100
        pct_vs_sma50 = (closes[last] - sma50[last])   / sma50[last] * 100
        records.append({
            "month":        key,
            "close":        float(closes[last]),
            "adx":          float(adx[last]),
            "rsi":          float(rsi_arr[last]),
            "pct_vs_sma50": float(pct_vs_sma50),
            "monthly_ret":  float(monthly_ret),
            "hv20":         float(hv20[last]),
        })
    return records


def _classify(adx: float, rsi: float, pct: float, ret: float, hv_ratio: float) -> str:
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


# ── Batch computation ──────────────────────────────────────────────────────────

def compute(incremental: bool = False) -> pl.DataFrame:
    """Compute markov_regimes. Always full recompute (incremental ignored)."""
    t0 = time.perf_counter()

    con = get_connection()
    rows = con.execute("""
        SELECT
            symbol,
            STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
            close, high, low
        FROM equities_prices
        ORDER BY symbol, date
    """).fetchall()

    # Group by symbol
    sym_data: dict[str, dict] = defaultdict(lambda: {"dates": [], "c": [], "h": [], "l": []})
    for symbol, date_str, c, h, l in rows:
        sym_data[symbol]["dates"].append(date_str)
        sym_data[symbol]["c"].append(c)
        sym_data[symbol]["h"].append(h)
        sym_data[symbol]["l"].append(l)

    all_records: list[dict] = []
    skipped = 0

    for symbol, data in sym_data.items():
        dates  = data["dates"]
        closes = np.array(data["c"], dtype=float)
        highs  = np.array(data["h"], dtype=float)
        lows   = np.array(data["l"], dtype=float)

        if len(closes) < 100:
            skipped += 1
            continue

        adx_arr  = _compute_adx(highs, lows, closes)
        rsi_arr  = _compute_rsi(closes)
        sma50    = _compute_sma(closes, 50)
        hv20_arr = _compute_hv20(closes)

        monthly_recs = _resample_monthly(closes, adx_arr, rsi_arr, sma50, hv20_arr, dates)
        if len(monthly_recs) < 6:
            skipped += 1
            continue

        all_hv   = [r["hv20"] for r in monthly_recs]
        median_hv = float(np.median(all_hv)) if all_hv else 1.0
        if median_hv < 1e-6:
            median_hv = 1.0

        for rec in monthly_recs:
            hv_ratio = rec["hv20"] / median_hv
            regime   = _classify(rec["adx"], rec["rsi"], rec["pct_vs_sma50"], rec["monthly_ret"], hv_ratio)
            all_records.append({
                "symbol":      symbol,
                "month":       rec["month"],
                "close":       round(rec["close"],        4),
                "adx":         round(rec["adx"],          2),
                "rsi":         round(rec["rsi"],          2),
                "pct_vs_sma50": round(rec["pct_vs_sma50"], 4),
                "monthly_ret": round(rec["monthly_ret"],  4),
                "hv20":        round(rec["hv20"],         4),
                "hv_ratio":    round(hv_ratio,            4),
                "regime":      regime,
            })

    if skipped:
        log.warning("%s: skipped %d symbols (insufficient data)", NAME, skipped)

    df = pl.DataFrame(all_records, schema={
        "symbol":       pl.Utf8,
        "month":        pl.Utf8,
        "close":        pl.Float64,
        "adx":          pl.Float64,
        "rsi":          pl.Float64,
        "pct_vs_sma50": pl.Float64,
        "monthly_ret":  pl.Float64,
        "hv20":         pl.Float64,
        "hv_ratio":     pl.Float64,
        "regime":       pl.Utf8,
    }).sort(["symbol", "month"])

    log.info("%s: %d rows, %d symbols in %.1fs",
             NAME, len(df), df["symbol"].n_unique(), time.perf_counter() - t0)
    return df
