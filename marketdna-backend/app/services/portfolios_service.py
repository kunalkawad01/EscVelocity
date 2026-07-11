"""
Quant Portfolios service — OHLCV-only "smallcase for traders" baskets.

Every portfolio is generated from price and volume alone (no fundamentals, news,
or ratings), scored 0–100, and returned with per-stock explainability (the exact
criteria each name passed). Backtests rebuild features AS OF each rebalance date
with a strict `date <= asof` guard, so there is no look-ahead.

Follows MarketDNA backend conventions:
  * reads the shared `equities_prices` DuckDB view via duckdb_client.get_connection()
  * casts the timezone-aware date column with CAST(date AS DATE) everywhere
  * heavy rolling-window math in DuckDB; light per-symbol stats in NumPy/pandas
  * day-level in-process cache + invalidate_cache() (mirrors stock_metrics)

Universe selection
------------------
The screen/backtest are restricted to a user-chosen universe: "nifty200" or
"nifty500" (default). Membership + company names come from the authoritative NSE
constituent CSVs in marketdna-data/ (ind_nifty200list.csv / ind_nifty500list.csv),
the same files live_trading_service uses. If a CSV is missing, the service falls
back to the full equities_prices view (no filter) and logs a warning.

Benchmark for relative strength = equal-weighted average close across the SELECTED
universe (the documented NIFTY proxy). Because the panel SQL is filtered to the
universe before the benchmark CTE runs, a Nifty 200 basket is measured against the
Nifty 200 proxy and a Nifty 500 basket against the Nifty 500 proxy. All RS features
here are ratio/slope based and thus invariant to the benchmark's price scale, so the
simple average is sufficient.
"""
from __future__ import annotations

import csv
import functools
import logging
import os
from dataclasses import dataclass
from datetime import date as _date
from typing import Any, Callable

import numpy as np
import pandas as pd

from app.services.duckdb_client import get_connection

log = logging.getLogger(__name__)

BARS_1M, BARS_3M, BARS_6M, BARS_12M = 21, 63, 126, 252
TRADING_DAYS_YEAR = 252
KEEP_TRAILING = 300          # trailing bars handed to the pandas step
MIN_HISTORY = 200
RISK_FREE_RATE = 0.065

DEFAULT_UNIVERSE = "nifty500"
_UNIVERSE_CSV = {
    "nifty200": "ind_nifty200list.csv",
    "nifty500": "ind_nifty500list.csv",
}


# ── Universe membership + company names (from NSE constituent CSVs) ────────────
@functools.lru_cache(maxsize=4)
def _load_universe(universe: str) -> tuple[frozenset[str], tuple[tuple[str, str], ...]]:
    """(symbols, name_pairs) for a universe. Cached; falls back to empty on error.

    Returns names as a tuple of (symbol, name) pairs so the cached value is
    immutable. An empty symbol set means "no filter" (use full equities_prices).
    """
    fname = _UNIVERSE_CSV.get(universe, _UNIVERSE_CSV[DEFAULT_UNIVERSE])
    path = os.path.normpath(os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "marketdna-data", fname))
    syms: set[str] = set()
    names: dict[str, str] = {}
    try:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                if row.get("Series", "").strip() != "EQ":
                    continue
                sym = (row.get("Symbol") or "").strip()
                if not sym:
                    continue
                syms.add(sym)
                nm = (row.get("Company Name") or "").strip()
                if nm:
                    names[sym] = nm
    except Exception as exc:  # degrade to unfiltered universe
        log.warning("universe csv %s unavailable (%s); using full equities_prices", fname, exc)
    return frozenset(syms), tuple(sorted(names.items()))


def _universe_symbols(universe: str) -> frozenset[str]:
    return _load_universe(universe)[0]


def _name_map(universe: str) -> dict[str, str]:
    return dict(_load_universe(universe)[1])


def _sym_in_clause(universe: str) -> str:
    """`` (no filter) or ` AND symbol IN ('A','B',...)` for embedding in SQL."""
    syms = _universe_symbols(universe)
    if not syms:
        return ""
    inlist = ",".join("'" + s.replace("'", "''") + "'" for s in sorted(syms))
    return f" AND symbol IN ({inlist})"


# ── Day-level cache (L1 in-process; mirrors stock_metrics pattern) ────────────
_cache: dict[tuple, Any] = {}


def _day_cached(fn: Callable) -> Callable:
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        today = str(_date.today())
        key = (fn.__name__, today) + args + tuple(sorted(kwargs.items()))
        if key in _cache:
            return _cache[key]
        for k in [k for k in list(_cache) if k[1] != today]:
            del _cache[k]
        result = fn(*args, **kwargs)
        _cache[key] = result
        return result
    return wrapper


def invalidate_cache() -> None:
    """Clear all portfolio caches (call after EOD ingestion)."""
    _cache.clear()


def start_prewarm(universe: str = DEFAULT_UNIVERSE) -> None:
    """Warm the day-caches so the first Portfolios page load is instant.

    Run from the background prewarm thread at startup. The ~10s panel query
    (build_features) and ~7s trailing-returns scan are shared day-caches — warming
    them here means the first user request pays 0s instead of 15-20s. Also warms
    every portfolio's screen (cheap once build_features is cached)."""
    build_features(universe=universe)
    for key in all_portfolios():
        try:
            get_screen(key, universe=universe)
        except Exception:  # a screen with 0 holdings must not abort prewarm
            pass
    from app.services import portfolios_tracker_service as pts
    pts._returns_table(universe)


# ── DuckDB feature pipeline ───────────────────────────────────────────────────
_PANEL_SQL = """
WITH base AS (
    SELECT symbol, CAST(date AS DATE) AS d, open, high, low, close, volume
    FROM equities_prices
    WHERE CAST(date AS DATE) <= DATE '{asof}'{sym_filter}
),
bench AS (
    SELECT d, AVG(close) AS bench_close FROM base GROUP BY d
),
lagged AS (
    SELECT *, lag(close) OVER w AS prev_close, lag(high) OVER w AS prev_high,
              lag(low) OVER w AS prev_low
    FROM base WINDOW w AS (PARTITION BY symbol ORDER BY d)
),
derived AS (
    SELECT *,
        greatest(high-low, abs(high-prev_close), abs(low-prev_close)) AS tr,
        greatest(close-prev_close,0) AS gain,
        greatest(prev_close-close,0) AS loss,
        abs(close-prev_close) AS abs_chg,
        CASE WHEN (high-prev_high)>(prev_low-low) AND (high-prev_high)>0 THEN (high-prev_high) ELSE 0 END AS plus_dm,
        CASE WHEN (prev_low-low)>(high-prev_high) AND (prev_low-low)>0 THEN (prev_low-low) ELSE 0 END AS minus_dm
    FROM lagged
),
roll AS (
    SELECT *,
        avg(close) OVER w20 AS sma20, avg(close) OVER w50 AS sma50, avg(close) OVER w200 AS sma200,
        stddev_samp(close) OVER w20 AS std20,
        avg(tr) OVER w14 AS atr14, avg(gain) OVER w14 AS avg_gain14, avg(loss) OVER w14 AS avg_loss14,
        avg(plus_dm) OVER w14 AS avg_pdm14, avg(minus_dm) OVER w14 AS avg_mdm14,
        avg(volume) OVER w20 AS avg_vol20, max(volume) OVER w20 AS max_vol20,
        max(high) OVER w20 AS high20, max(high) OVER w60 AS high60,
        max(high) OVER w252 AS high252, min(low) OVER w252 AS low252, max(close) OVER w252 AS roll_max252,
        sum(abs_chg) OVER w126 AS sum_abs_chg126,
        lag(close,21) OVER w AS close_1m, lag(close,63) OVER w AS close_3m,
        lag(close,126) OVER w AS close_6m, lag(close,252) OVER w AS close_12m
    FROM derived
    WINDOW
        w AS (PARTITION BY symbol ORDER BY d),
        w14  AS (PARTITION BY symbol ORDER BY d ROWS BETWEEN 13  PRECEDING AND CURRENT ROW),
        w20  AS (PARTITION BY symbol ORDER BY d ROWS BETWEEN 19  PRECEDING AND CURRENT ROW),
        w50  AS (PARTITION BY symbol ORDER BY d ROWS BETWEEN 49  PRECEDING AND CURRENT ROW),
        w60  AS (PARTITION BY symbol ORDER BY d ROWS BETWEEN 59  PRECEDING AND CURRENT ROW),
        w126 AS (PARTITION BY symbol ORDER BY d ROWS BETWEEN 125 PRECEDING AND CURRENT ROW),
        w200 AS (PARTITION BY symbol ORDER BY d ROWS BETWEEN 199 PRECEDING AND CURRENT ROW),
        w252 AS (PARTITION BY symbol ORDER BY d ROWS BETWEEN 251 PRECEDING AND CURRENT ROW)
),
scalar AS (
    SELECT *,
        100 - 100/(1 + avg_gain14/nullif(avg_loss14,0)) AS rsi14,
        100*avg_pdm14/nullif(atr14,0) AS plus_di, 100*avg_mdm14/nullif(atr14,0) AS minus_di,
        atr14/nullif(close,0) AS atr_pct,
        sma20+2*std20 AS bb_upper, sma20-2*std20 AS bb_lower, (4*std20)/nullif(sma20,0) AS bb_width,
        close/nullif(roll_max252,0)-1 AS drawdown,
        close/nullif(high252,0)-1 AS dist_52w_high, close/nullif(low252,0)-1 AS dist_52w_low,
        volume/nullif(avg_vol20,0) AS vol_surge,
        close/nullif(close_1m,0)-1 AS ret_1m, close/nullif(close_3m,0)-1 AS ret_3m,
        close/nullif(close_6m,0)-1 AS ret_6m, close/nullif(close_12m,0)-1 AS ret_12m,
        abs(close-close_6m)/nullif(sum_abs_chg126,0) AS efficiency_ratio
    FROM roll
),
dxed AS (
    SELECT *, 100*abs(plus_di-minus_di)/nullif(plus_di+minus_di,0) AS dx FROM scalar
),
adxed AS (
    SELECT *,
        avg(dx) OVER (PARTITION BY symbol ORDER BY d ROWS BETWEEN 13 PRECEDING AND CURRENT ROW) AS adx14,
        row_number() OVER (PARTITION BY symbol ORDER BY d DESC) AS rn_end
    FROM dxed
)
SELECT a.symbol, a.d AS date, a.close, a.volume,
       a.sma20, a.sma50, a.sma200, a.atr14, a.atr_pct, a.rsi14, a.adx14,
       a.std20, a.bb_upper, a.bb_lower, a.bb_width, a.avg_vol20, a.max_vol20, a.vol_surge,
       a.high20, a.high60, a.high252, a.low252, a.roll_max252,
       a.drawdown, a.dist_52w_high, a.dist_52w_low,
       a.ret_1m, a.ret_3m, a.ret_6m, a.ret_12m, a.efficiency_ratio,
       b.bench_close, a.rn_end
FROM adxed a LEFT JOIN bench b USING (d)
WHERE a.rn_end <= {keep}
ORDER BY a.symbol, a.d
"""


def _trend_stats(logclose: np.ndarray) -> tuple[float, float]:
    n = len(logclose)
    if n < 20 or np.any(~np.isfinite(logclose)):
        return np.nan, np.nan
    x = np.arange(n, dtype=float)
    slope, intercept = np.polyfit(x, logclose, 1)
    fit = slope * x + intercept
    ss_res = np.sum((logclose - fit) ** 2)
    ss_tot = np.sum((logclose - logclose.mean()) ** 2)
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else np.nan
    return r2, np.exp(slope * TRADING_DAYS_YEAR) - 1


@_day_cached
def build_features(asof: str | None = None, universe: str = DEFAULT_UNIVERSE) -> pd.DataFrame:
    """One-row-per-symbol as-of feature table for a universe. asof=None -> latest bar.

    Day-cached by (asof, universe): the ~10s panel query + per-symbol numpy pass is
    shared across all portfolio screens for the same universe/day. Callers treat the
    returned frame as read-only (screeners `.copy()` before mutating).
    """
    con = get_connection()
    if asof is None:
        asof = con.execute("SELECT MAX(CAST(date AS DATE)) FROM equities_prices").fetchone()[0]
    panel = con.execute(
        _PANEL_SQL.format(asof=asof, keep=KEEP_TRAILING, sym_filter=_sym_in_clause(universe))
    ).df()
    if panel.empty:
        return pd.DataFrame()

    rows = []
    for symbol, g in panel.groupby("symbol", sort=False):
        g = g.sort_values("date")
        if len(g) < MIN_HISTORY:
            continue
        last = g.iloc[-1]
        close = g["close"].to_numpy(dtype=float)

        atr_series = g["atr14"].dropna().to_numpy()[-TRADING_DAYS_YEAR:]
        atr_now = last["atr14"]
        atr_pctile = (float((atr_series <= atr_now).mean()) * 100
                      if len(atr_series) and np.isfinite(atr_now) else np.nan)

        win = close[-BARS_6M:]
        r2, _ = _trend_stats(np.log(win[win > 0])) if len(win) >= 20 else (np.nan, np.nan)
        rets = np.diff(close[-(BARS_6M + 1):]) if len(close) > BARS_6M else np.diff(close)
        consistency = float((rets > 0).mean()) * 100 if len(rets) else np.nan
        yr = close[-TRADING_DAYS_YEAR:]
        cagr = ((yr[-1] / yr[0]) ** (TRADING_DAYS_YEAR / len(yr)) - 1) if len(yr) >= 60 and yr[0] > 0 else np.nan
        max_dd = float((yr / np.maximum.accumulate(yr) - 1).min()) if len(yr) else np.nan

        bench = g["bench_close"].to_numpy(dtype=float)
        rs_ret_6m = np.nan
        rs_slope_up = rs_above = False
        if np.isfinite(bench).sum() > BARS_6M:
            ratio = pd.Series(close / bench).replace([np.inf, -np.inf], np.nan).ffill().to_numpy()
            rwin = ratio[-BARS_6M:]
            if np.isfinite(rwin).all() and rwin[0] > 0:
                rs_ret_6m = rwin[-1] / rwin[0] - 1
                rs_slope_up = bool(np.polyfit(np.arange(len(rwin)), rwin, 1)[0] > 0)
                rs_above = bool(ratio[-1] > np.mean(ratio[-200:]))

        lw = close[-BARS_3M:]
        higher_lows = bool(len(lw) >= 40 and lw[len(lw)//2:].min() > lw[:len(lw)//2].min())

        rows.append({
            "symbol": symbol, "date": last["date"], "close": last["close"],
            "sma20": last["sma20"], "sma50": last["sma50"], "sma200": last["sma200"], "std20": last["std20"],
            "atr14": last["atr14"], "atr_pct": last["atr_pct"], "atr_pctile": atr_pctile,
            "rsi14": last["rsi14"], "adx14": last["adx14"], "bb_width": last["bb_width"],
            "bb_lower": last["bb_lower"], "bb_upper": last["bb_upper"],
            "pctb": (last["close"] - last["bb_lower"]) / (last["bb_upper"] - last["bb_lower"])
                    if (last["bb_upper"] - last["bb_lower"]) else np.nan,
            "avg_vol20": last["avg_vol20"], "vol_surge": last["vol_surge"],
            "high20": last["high20"], "high60": last["high60"], "high252": last["high252"], "low252": last["low252"],
            "dist_52w_high": last["dist_52w_high"], "dist_52w_low": last["dist_52w_low"], "drawdown": last["drawdown"],
            "ret_1m": last["ret_1m"], "ret_3m": last["ret_3m"], "ret_6m": last["ret_6m"], "ret_12m": last["ret_12m"],
            "efficiency_ratio": last["efficiency_ratio"], "r2": r2, "consistency": consistency,
            "cagr": cagr, "max_dd_1y": max_dd, "rs_ret_6m": rs_ret_6m,
            "rs_slope_up": rs_slope_up, "rs_above_sma200": rs_above, "higher_lows": higher_lows,
            "above_sma200": bool(last["close"] > last["sma200"]) if np.isfinite(last["sma200"]) else False,
            "above_sma50": bool(last["close"] > last["sma50"]) if np.isfinite(last["sma50"]) else False,
            "golden_cross": bool(last["sma50"] > last["sma200"]) if np.isfinite(last["sma200"]) else False,
            "new_52w_high": bool(last["close"] >= last["high252"] * 0.999) if np.isfinite(last["high252"]) else False,
            "break_60d_high": bool(last["close"] >= last["high60"] * 0.999) if np.isfinite(last["high60"]) else False,
        })

    feats = pd.DataFrame(rows)
    if feats.empty:
        return feats
    feats = feats.set_index("symbol")
    feats["mom_score"] = (0.4 * feats["ret_12m"].fillna(-9) + 0.3 * feats["ret_6m"].fillna(-9)
                          + 0.2 * feats["ret_3m"].fillna(-9) + 0.1 * feats["ret_1m"].fillna(-9))
    feats["mom_rank"] = feats["mom_score"].rank(pct=True) * 100
    feats["rs_rank"] = feats["rs_ret_6m"].rank(pct=True) * 100
    feats["atr_pct_rank"] = feats["atr_pct"].rank(pct=True) * 100
    # Convenience derived fields for the custom-portfolio rule engine (Option C):
    # normalized "distance from mean" so users can write `z20 > 3` (3 std devs above
    # SMA20) rather than the raw price-sigma `std20`, which is in rupees.
    feats["z20"] = (feats["close"] - feats["sma20"]) / feats["std20"].replace(0, np.nan)
    feats["dist_sma50_pct"] = feats["close"] / feats["sma50"] - 1
    feats["dist_sma200_pct"] = feats["close"] / feats["sma200"] - 1
    # Ordinal cross-sectional ranks (1 = highest return) — enable "top-N by X" +
    # set-intersection rules, e.g. `ret_12m_rank <= 20 and ret_6m_rank <= 20`.
    # (Distinct from the percentile *_rank fields above, which are 0–100.)
    for h in ("ret_1m", "ret_3m", "ret_6m", "ret_12m"):
        feats[f"{h}_rank"] = feats[h].rank(ascending=False, method="min")
    return feats


# ── explainability + scoring helpers ──────────────────────────────────────────
def _scale(s: pd.Series) -> pd.Series:
    s = s.astype(float)
    lo, hi = s.min(), s.max()
    if not np.isfinite(lo) or hi == lo:
        return pd.Series(50.0, index=s.index)
    return (s - lo) / (hi - lo) * 100


def _explain(df: pd.DataFrame, checks: list[tuple]) -> pd.DataFrame:
    reasons, checklist = [], []
    for sym in df.index:
        r, cl = [], []
        for label, passed, value in checks:
            p = bool(passed.get(sym, False)) if hasattr(passed, "get") else bool(passed)
            v = value.get(sym, np.nan) if hasattr(value, "get") else value
            v = None if (isinstance(v, float) and not np.isfinite(v)) else (round(float(v), 3) if isinstance(v, (int, float, np.floating)) else None)
            cl.append({"label": label, "passed": p, "value": v})
            if p:
                r.append(label)
        reasons.append(r)
        checklist.append(cl)
    df = df.copy()
    df["reasons"], df["checks"] = reasons, checklist
    return df


# ── the 10 portfolios ─────────────────────────────────────────────────────────
def _strong_trend(f, size=25, **_):
    q = f[f["above_sma200"] & f["golden_cross"] & (f["adx14"] > 25) & (f["atr_pctile"] < 70) & (f["dist_52w_high"] > -0.10)].copy()
    if q.empty: return q
    q["score"] = 0.35*_scale(q["adx14"]) + 0.30*_scale(q["r2"].fillna(0)) + 0.20*_scale(q["mom_score"]) + 0.15*_scale(q["rs_ret_6m"].fillna(0))
    q = _explain(q, [("Price > SMA200", q["above_sma200"], f["close"]/f["sma200"]-1),
                     ("SMA50 > SMA200 (golden cross)", q["golden_cross"], q["sma50"]/q["sma200"]-1),
                     ("ADX > 25 (strong trend)", q["adx14"]>25, q["adx14"]),
                     ("ATR percentile < 70", q["atr_pctile"]<70, q["atr_pctile"]),
                     ("Within 10% of 52w high", q["dist_52w_high"]>-0.10, q["dist_52w_high"]),
                     ("New 52-week high", q["new_52w_high"], q["dist_52w_high"])])
    return q.sort_values("score", ascending=False).head(size)


def _quiet_breakout(f, size=20, **_):
    q = f[(f["atr_pct_rank"] < 40) & f["break_60d_high"] & (f["vol_surge"] > 1.5)].copy()
    if q.empty: return q
    q["score"] = 0.4*_scale(-q["atr_pct_rank"]) + 0.4*_scale(q["vol_surge"]) + 0.2*_scale(q["ret_1m"].fillna(0))
    q = _explain(q, [("Low 20d volatility (ATR pct-rank < 40)", q["atr_pct_rank"]<40, q["atr_pct_rank"]),
                     ("Volume surge > 1.5x", q["vol_surge"]>1.5, q["vol_surge"]),
                     ("Breaks 60-day high", q["break_60d_high"], q["dist_52w_high"])])
    return q.sort_values("score", ascending=False).head(size)


def _momentum_leaders(f, size=20, **_):
    q = f[f["ret_12m"].notna()].copy()
    if q.empty: return q
    q["score"] = _scale(q["mom_score"])
    q = _explain(q, [("12M return (40% weight)", q["ret_12m"].notna(), q["ret_12m"]),
                     ("6M return (30% weight)", q["ret_6m"].notna(), q["ret_6m"]),
                     ("3M return (20% weight)", q["ret_3m"].notna(), q["ret_3m"]),
                     ("1M return (10% weight)", q["ret_1m"].notna(), q["ret_1m"]),
                     ("Above SMA200 (trend confirm)", q["above_sma200"], q["above_sma200"].astype(float))])
    return q.sort_values("mom_score", ascending=False).head(size)


def _relative_strength(f, size=20, **_):
    q = f[f["rs_above_sma200"] & f["rs_slope_up"] & f["above_sma200"] & (f["rs_ret_6m"] > 0)].copy()
    if q.empty: return q
    q["score"] = 0.6*_scale(q["rs_ret_6m"]) + 0.4*_scale(q["mom_score"])
    q = _explain(q, [("Outperforming NIFTY proxy (6M RS > 0)", q["rs_ret_6m"]>0, q["rs_ret_6m"]),
                     ("RS line above its SMA200", q["rs_above_sma200"], q["rs_above_sma200"].astype(float)),
                     ("RS slope positive", q["rs_slope_up"], q["rs_slope_up"].astype(float)),
                     ("Price above SMA200", q["above_sma200"], q["above_sma200"].astype(float))])
    return q.sort_values("score", ascending=False).head(size)


def _recovery(f, size=20, **_):
    deep = f["low252"]/f["high252"] - 1
    q = f[(deep <= -0.30) & f["above_sma50"] & (f["vol_surge"] > 1.1) & f["higher_lows"]].copy()
    if q.empty: return q
    rec = q["close"]/q["low252"] - 1
    q["score"] = 0.5*_scale(rec) + 0.3*_scale(q["ret_1m"].fillna(0)) + 0.2*_scale(q["rs_ret_6m"].fillna(0))
    q = _explain(q, [("Fell >=30% from 1y high", deep.loc[q.index]<=-0.30, deep.loc[q.index]),
                     ("Reclaimed SMA50", q["above_sma50"], q["above_sma50"].astype(float)),
                     ("Volume expanding (>1.1x)", q["vol_surge"]>1.1, q["vol_surge"]),
                     ("Higher lows forming", q["higher_lows"], q["higher_lows"].astype(float)),
                     ("Recovered off the low", rec>0, rec)])
    return q.sort_values("score", ascending=False).head(size)


def _vol_expansion(f, size=20, **_):
    br = f["close"] >= f["high20"]*0.999
    q = f[(f["atr_pctile"] > 60) & br & (f["vol_surge"] > 1.5)].copy()
    if q.empty: return q
    q["score"] = 0.4*_scale(q["atr_pctile"]) + 0.3*_scale(q["vol_surge"]) + 0.3*_scale(q["bb_width"])
    q = _explain(q, [("ATR percentile > 60 (expanding vol)", q["atr_pctile"]>60, q["atr_pctile"]),
                     ("Donchian 20d breakout", br.loc[q.index], q["dist_52w_high"]),
                     ("Bollinger width elevated", q["bb_width"].notna(), q["bb_width"]),
                     ("Volume surge > 1.5x", q["vol_surge"]>1.5, q["vol_surge"])])
    return q.sort_values("score", ascending=False).head(size)


def _mean_reversion(f, size=20, **_):
    q = f[(f["rsi14"] < 30) & (f["pctb"] < 0.2) & (f["vol_surge"] > 1.0)].copy()
    if q.empty: return q
    q["score"] = 0.6*_scale(-q["rsi14"]) + 0.4*_scale(-q["pctb"])
    q = _explain(q, [("RSI(14) < 30 (oversold)", q["rsi14"]<30, q["rsi14"]),
                     ("Near lower Bollinger band (%B < 0.2)", q["pctb"]<0.2, q["pctb"]),
                     ("Volume present (>1x avg)", q["vol_surge"]>1.0, q["vol_surge"]),
                     ("Above SMA200 (quality dip)", q["above_sma200"], q["above_sma200"].astype(float))])
    return q.sort_values("score", ascending=False).head(size)


def _trend_quality(f, size=20, **_):
    q = f[f["above_sma200"] & f["r2"].notna() & (f["ret_6m"] > 0)].copy()
    if q.empty: return q
    q["score"] = 0.4*_scale(q["r2"]) + 0.3*_scale(q["efficiency_ratio"].fillna(0)) + 0.2*_scale(q["consistency"].fillna(0)) + 0.1*_scale(q["mom_score"])
    q = _explain(q, [("High trend R^2 (smooth uptrend)", q["r2"]>0.7, q["r2"]),
                     ("High efficiency ratio", q["efficiency_ratio"]>0.3, q["efficiency_ratio"]),
                     ("Consistent up-days", q["consistency"]>50, q["consistency"]),
                     ("Positive 6M return", q["ret_6m"]>0, q["ret_6m"])])
    return q.sort_values("score", ascending=False).head(size)


def _sector_rotation(f, size=15, top_sectors=3, per_sector=5, **_):
    sec = _sector_map()
    if not sec:
        return f.iloc[0:0]
    q = f[f["mom_score"].notna()].copy()
    q["sector"] = q.index.map(sec)
    q = q[q["sector"].notna()]
    if q.empty: return q
    winners = q.groupby("sector")["mom_score"].median().sort_values(ascending=False).head(top_sectors).index.tolist()
    picks = [q[q["sector"] == s].sort_values("mom_score", ascending=False).head(per_sector) for s in winners]
    out = pd.concat(picks) if picks else q.iloc[0:0]
    out["score"] = _scale(out["mom_score"])
    out = _explain(out, [("In a top-3 momentum sector", out["sector"].isin(winners), out["mom_score"]),
                         ("Top-5 momentum within its sector", out["mom_score"].notna(), out["mom_score"]),
                         ("Above SMA200", out["above_sma200"], out["above_sma200"].astype(float))])
    return out.sort_values(["sector", "score"], ascending=[True, False])


def _low_risk_compounders(f, size=20, **_):
    q = f[(f["cagr"] > 0.05) & (f["max_dd_1y"] > -0.25) & (f["atr_pct_rank"] < 50) & (f["r2"] > 0.5)].copy()
    if q.empty: return q
    pain = q["cagr"] / q["max_dd_1y"].abs().replace(0, np.nan)
    q["score"] = 0.5*_scale(pain.fillna(0)) + 0.3*_scale(q["r2"]) + 0.2*_scale(-q["atr_pct_rank"])
    q = _explain(q, [("Positive 1y CAGR", q["cagr"]>0.05, q["cagr"]),
                     ("Shallow drawdown (> -25%)", q["max_dd_1y"]>-0.25, q["max_dd_1y"]),
                     ("Low volatility (ATR pct-rank < 50)", q["atr_pct_rank"]<50, q["atr_pct_rank"]),
                     ("Smooth trend (R^2 > 0.5)", q["r2"]>0.5, q["r2"])])
    return q.sort_values("score", ascending=False).head(size)


@dataclass
class Portfolio:
    key: str; name: str; description: str; expected_holding: str
    rebalance: str; size: int; select: Callable; volatility: int = 3


PORTFOLIOS: dict[str, Portfolio] = {p.key: p for p in [
    Portfolio("strong_trend", "Strong Trend", "Established up-trends confirmed by ADX, riding near 52-week highs without being overextended.", "3-6 months", "Weekly", 25, _strong_trend, 3),
    Portfolio("quiet_breakout", "Quiet Breakout", "Low-volatility coils breaking a 60-day high on a volume surge — prime swing setups.", "2-8 weeks", "Weekly", 20, _quiet_breakout, 4),
    Portfolio("momentum_leaders", "Momentum Leaders", "The classic multi-horizon momentum factor: top names by blended 1/3/6/12-month return.", "6-12 months", "Monthly", 20, _momentum_leaders, 4),
    Portfolio("relative_strength", "Relative Strength", "Structural NIFTY out-performers — rising RS line above its own long average.", "3-9 months", "Monthly", 20, _relative_strength, 3),
    Portfolio("recovery", "Recovery Candidates", "Deeply drawn-down names turning up: reclaimed SMA50, higher lows, volume returning.", "3-9 months", "Weekly", 20, _recovery, 4),
    Portfolio("vol_expansion", "Volatility Expansion", "Range breakouts with volatility and volume expanding together — momentum ignition.", "1-6 weeks", "Weekly", 20, _vol_expansion, 5),
    Portfolio("mean_reversion", "Mean Reversion", "Oversold snapback: RSI<30 near the lower band with volume, for tactical bounces.", "3-15 days", "Weekly", 20, _mean_reversion, 5),
    Portfolio("trend_quality", "Trend Quality", "The smoothest, most efficient trends by regression R-squared and efficiency ratio.", "6-12 months", "Monthly", 20, _trend_quality, 2),
    Portfolio("sector_rotation", "Sector Rotation", "Top stocks inside the strongest sectors — momentum applied top-down.", "1-3 months", "Weekly", 15, _sector_rotation, 3),
    Portfolio("low_risk_compounders", "Low Risk Compounders", "Steady, low-drawdown compounders: high return-to-pain and smooth equity curves.", "12+ months", "Monthly", 20, _low_risk_compounders, 1),
]}


@functools.lru_cache(maxsize=1)
def _sector_map() -> dict[str, str]:
    """symbol -> sector, reusing sector_heatmap's curated NSE500 universe layers."""
    try:
        from app.services.sector_heatmap_service import _build_sector_list
        out: dict[str, str] = {}
        for sec in _build_sector_list("nifty500"):
            for stk in sec["stocks"]:
                out[stk["symbol"]] = sec["name"]
        return out
    except Exception as exc:  # degrade gracefully if the helper changes
        log.warning("sector map unavailable, sector_rotation will be empty: %s", exc)
        return {}


# ── public API ────────────────────────────────────────────────────────────────
def get_portfolio(key: str):
    """Resolve a portfolio by key: built-in first, then user-defined (custom store).

    Raises ValueError if unknown — routers map that to 404."""
    if key in PORTFOLIOS:
        return PORTFOLIOS[key]
    from app.services import portfolios_store as store
    p = store.get_portfolio(key)
    if p is None:
        raise ValueError(f"Unknown portfolio '{key}'")
    return p


def all_portfolios() -> dict:
    """Built-in + custom portfolios, keyed by key (built-ins win on collision)."""
    from app.services import portfolios_store as store
    return {**store.all_portfolios(), **PORTFOLIOS}


def list_portfolios() -> list[dict]:
    return [{"key": p.key, "name": p.name, "description": p.description,
             "expected_holding": p.expected_holding, "rebalance": p.rebalance,
             "volatility_stars": p.volatility, "is_custom": getattr(p, "is_custom", False)}
            for p in all_portfolios().values()]


@_day_cached
def get_screen(key: str, size: int | None = None, universe: str = DEFAULT_UNIVERSE) -> dict:
    p = get_portfolio(key)
    feats = build_features(universe=universe)
    if feats.empty:
        raise ValueError("No features — is equities_prices populated with enough history?")
    holdings = p.select(feats, size=size or p.size)
    names = _name_map(universe)
    recs = []
    for sym, row in holdings.iterrows():
        w = row.get("weight")
        recs.append({"symbol": sym, "name": names.get(sym), "score": round(float(row["score"]), 1),
                     "weight": float(w) if w is not None and np.isfinite(w) else None,
                     "reasons": row["reasons"], "checks": row["checks"]})
    return {"key": p.key, "name": p.name, "description": p.description,
            "expected_holding": p.expected_holding, "rebalance": p.rebalance,
            "volatility_stars": p.volatility, "universe": universe,
            "as_of": str(feats["date"].max()), "count": len(recs), "holdings": recs}


def _price_panel(universe: str = DEFAULT_UNIVERSE) -> pd.DataFrame:
    con = get_connection()
    sql = "SELECT CAST(date AS DATE) AS date, symbol, close FROM equities_prices"
    syms = _universe_symbols(universe)
    if syms:
        inlist = ",".join("'" + s.replace("'", "''") + "'" for s in sorted(syms))
        sql += f" WHERE symbol IN ({inlist})"
    sql += " ORDER BY date"
    df = con.execute(sql).df()
    return df.pivot(index="date", columns="symbol", values="close").sort_index()


def _rebalance_dates(index, freq: str):
    idx = pd.to_datetime(index)
    period = {"W": "W", "M": "M", "Q": "Q"}.get(freq, "M")
    s = pd.Series(range(len(idx)), index=idx)
    return [g.index.max() for _, g in s.groupby(idx.to_period(period))]


@_day_cached
def get_backtest(key: str, freq: str = "M", start: str | None = None,
                 end: str | None = None, size: int | None = None, cost_bps: float = 25,
                 universe: str = DEFAULT_UNIVERSE) -> dict:
    p = get_portfolio(key)
    prices = _price_panel(universe=universe)
    prices.index = pd.to_datetime(prices.index)
    if start: prices = prices[prices.index >= pd.to_datetime(start)]
    if end:   prices = prices[prices.index <= pd.to_datetime(end)]
    rdates = [d for d in _rebalance_dates(prices.index, freq) if d in prices.index]
    if len(rdates) < 3:
        raise ValueError("Not enough history for a backtest over this range/frequency.")
    ppy = {"W": 52, "M": 12, "Q": 4}.get(freq, 12)

    rows = []
    for d0, d1 in zip(rdates[:-1], rdates[1:]):
        feats = build_features(asof=d0.strftime("%Y-%m-%d"), universe=universe)
        if feats.empty:
            rows.append({"date": d1, "ret": 0.0, "bench": 0.0}); continue
        basket = p.select(feats, size=size or p.size)
        syms = [s for s in basket.index if s in prices.columns]
        p0, p1 = prices.loc[d0], prices.loc[d1]
        if syms:
            r = (p1[syms] / p0[syms] - 1).replace([np.inf, -np.inf], np.nan).dropna()
            port = float(r.mean()) - cost_bps / 1e4 if len(r) else 0.0
        else:
            port = 0.0
        allr = (p1 / p0 - 1).replace([np.inf, -np.inf], np.nan).dropna()  # equal-weight index
        rows.append({"date": d1, "ret": port, "bench": float(allr.mean()) if len(allr) else 0.0})

    res = pd.DataFrame(rows).set_index("date")
    res["equity"] = 100 * (1 + res["ret"]).cumprod()
    res["bench_equity"] = 100 * (1 + res["bench"]).cumprod()
    return _metrics(p, res, ppy, freq, universe)


# ── Live intraday overlay (Phase 2) ──────────────────────────────────────────
# Holdings are fixed between rebalances; only their mark-to-market P&L ticks live.
# NOT day-cached — this endpoint must return fresh quotes on every poll.
def _last_two_closes(symbols: list[str]) -> dict[str, tuple[float, float]]:
    """{symbol: (last_close, prev_close)} from equities_prices — the CLOSED-market baseline."""
    if not symbols:
        return {}
    con = get_connection()
    inlist = ",".join("'" + s.replace("'", "''") + "'" for s in symbols)
    rows = con.execute(f"""
        WITH r AS (
            SELECT symbol, close,
                   row_number() OVER (PARTITION BY symbol ORDER BY CAST(date AS DATE) DESC) AS rn
            FROM equities_prices WHERE symbol IN ({inlist})
        )
        SELECT symbol,
               max(CASE WHEN rn=1 THEN close END) AS c1,
               max(CASE WHEN rn=2 THEN close END) AS c2
        FROM r WHERE rn <= 2 GROUP BY symbol
    """).fetchall()
    out: dict[str, tuple[float, float]] = {}
    for sym, c1, c2 in rows:
        if c1 is not None and c2 is not None:
            out[sym] = (float(c1), float(c2))
    return out


def get_live(key: str, universe: str = DEFAULT_UNIVERSE) -> dict:
    """Live (or last-session) mark-to-market of a portfolio's current basket.

    The holdings come from the day-cached screen (fixed between rebalances). Each
    holding's return is (LTP / prev_close - 1) from Kite while the market is LIVE,
    or (last_close / prev_close - 1) from DuckDB when CLOSED. Basket return is the
    equal-weighted mean across holdings with a usable quote.
    """
    p = get_portfolio(key)
    # Local imports keep this off the module import path (avoids circulars).
    from app.services import live_trading_service
    from app.services.fno_tactical_service import resolve_market_state

    screen = get_screen(key, universe=universe)
    names = _name_map(universe)
    symbols = [h["symbol"] for h in screen["holdings"]]
    state = resolve_market_state()
    is_live = bool(state.get("is_live"))

    quotes: dict[str, dict] = {}
    if is_live and symbols:
        try:
            quotes = live_trading_service._quotes(symbols)
        except Exception as exc:  # degrade to EOD baseline if Kite is unavailable
            log.warning("live quotes failed for %s, falling back to EOD: %s", key, exc)
            quotes = {}
    source = "live" if quotes else "eod"
    eod = {} if quotes else _last_two_closes(symbols)

    holdings, rets = [], []
    for sym in symbols:
        ltp = ret = None
        if sym in quotes:
            q = quotes[sym]
            ltp = q.get("ltp")
            pc = q.get("prev_close")
            if ltp and pc:
                ret = ltp / pc - 1.0
        elif sym in eod:
            c1, c2 = eod[sym]
            ltp = c1
            if c2:
                ret = c1 / c2 - 1.0
        if ret is not None and np.isfinite(ret):
            rets.append(ret)
        holdings.append({
            "symbol": sym, "name": names.get(sym),
            "ltp": round(float(ltp), 2) if ltp is not None else None,
            "return_pct": round(float(ret) * 100, 2) if ret is not None else None,
        })

    basket = round(float(np.mean(rets)) * 100, 2) if rets else None
    advancers = sum(1 for h in holdings if (h["return_pct"] or 0) > 0)
    decliners = sum(1 for h in holdings if (h["return_pct"] or 0) < 0)
    return {
        "key": key, "name": p.name, "universe": universe,
        "state": state.get("state"), "state_label": state.get("label"),
        "is_live": is_live, "source": source, "server_time": state.get("server_time"),
        "as_of": screen["as_of"], "count": len(holdings),
        "basket_return_pct": basket, "advancers": advancers, "decliners": decliners,
        "holdings": holdings,
    }


def _metrics(p, res, ppy, freq, universe=DEFAULT_UNIVERSE) -> dict:
    r = res["ret"].to_numpy(); eq = res["equity"]; years = len(r) / ppy
    cagr = (eq.iloc[-1] / 100) ** (1 / years) - 1 if years > 0 else np.nan
    vol = r.std(ddof=1) * np.sqrt(ppy) if len(r) > 1 else np.nan
    rf_p = RISK_FREE_RATE / ppy; excess = r - rf_p
    sd = r.std(ddof=1)
    sharpe = excess.mean() / sd * np.sqrt(ppy) if sd > 0 else np.nan
    dn = r[r < rf_p] - rf_p
    dstd = np.sqrt((dn ** 2).mean()) if len(dn) else np.nan
    sortino = excess.mean() / dstd * np.sqrt(ppy) if dstd and dstd > 0 else np.nan
    max_dd = float((eq / eq.cummax() - 1).min())
    bench_cagr = (res["bench_equity"].iloc[-1] / 100) ** (1 / years) - 1 if years > 0 else np.nan
    m = pd.Series(r, index=pd.to_datetime(res.index))
    heat = m.groupby([m.index.year, m.index.month]).apply(lambda s: (1 + s).prod() - 1)
    f = lambda x: round(float(x), 2) if np.isfinite(x) else None
    return {
        "key": p.key, "name": p.name, "freq": freq, "universe": universe, "periods": len(r), "years": round(years, 2),
        "total_return_pct": round((eq.iloc[-1] / 100 - 1) * 100, 1), "cagr_pct": round(cagr * 100, 1),
        "vol_pct": round(vol * 100, 1), "sharpe": f(sharpe), "sortino": f(sortino),
        "max_drawdown_pct": round(max_dd * 100, 1), "hit_rate_pct": round(float((r > 0).mean()) * 100, 1),
        "alpha_pct": round((cagr - bench_cagr) * 100, 1) if np.isfinite(cagr) and np.isfinite(bench_cagr) else None,
        "best_period_pct": round(float(r.max()) * 100, 1), "worst_period_pct": round(float(r.min()) * 100, 1),
        "final_growth_of_100": round(float(eq.iloc[-1]), 1), "bench_growth_of_100": round(float(res["bench_equity"].iloc[-1]), 1),
        "equity_curve": {str(k.date()): round(float(v), 2) for k, v in eq.items()},
        "bench_curve": {str(k.date()): round(float(v), 2) for k, v in res["bench_equity"].items()},
        "monthly_returns": {f"{y}-{mo:02d}": round(float(v) * 100, 2) for (y, mo), v in heat.items()},
    }
