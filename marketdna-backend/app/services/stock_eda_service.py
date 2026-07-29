"""Stock EDA service — visualization-heavy exploratory stats for a single symbol.

Pure NumPy/Polars over `equities_prices`. No FastAPI imports, no HTTP logic.
Every function does exactly one bulk DuckDB fetch per symbol, then computes
in-memory — never per-row DuckDB round-trips.
"""
from __future__ import annotations

import functools
from datetime import date as _date, datetime
from typing import Any, Callable

import numpy as np
import polars as pl

from app.services.duckdb_client import get_connection
from app.models.stock_eda import (
    VolatilityPoint, VolatilitySeriesResponse,
    DrawdownEpisode, DrawdownHistoryResponse,
    SeasonalityCell, SeasonalityResponse,
    GapPoint, GapBucket, GapsResponse,
    VolumeProfileBin, VolumeProfileResponse,
    ACFPoint, AutocorrelationResponse,
    ExtremeDay, ExtremeDaysResponse,
    BenchmarkDayComparison, BenchmarkComparisonResponse,
)

# ── Day-level in-process cache (mirrors stock_metrics._day_cached) ─────────────
_cache: dict[tuple, Any] = {}


def _day_cached(fn: Callable) -> Callable:
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        today = str(_date.today())
        key = (fn.__name__, today) + args + tuple(sorted(kwargs.items()))
        if key in _cache:
            return _cache[key]
        stale = [k for k in list(_cache) if k[1] != today]
        for k in stale:
            del _cache[k]
        result = fn(*args, **kwargs)
        _cache[key] = result
        return result
    return wrapper


def invalidate(symbol: str | None = None) -> None:
    if symbol:
        for k in list(_cache):
            if symbol in k:
                del _cache[k]
    else:
        _cache.clear()


# ── Shared bulk fetch ───────────────────────────────────────────────────────────

def _fetch_ohlcv_arrays(symbol: str) -> dict[str, np.ndarray]:
    con = get_connection()
    df = con.execute(
        """
        SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d, open, high, low, close, volume
        FROM equities_prices
        WHERE symbol = ?
        ORDER BY d
        """,
        [symbol],
    ).pl()
    if df.height == 0:
        raise ValueError(f"No data for symbol {symbol}")
    return {
        "dates": df["d"].to_numpy(),
        "open": df["open"].to_numpy().astype(np.float64),
        "high": df["high"].to_numpy().astype(np.float64),
        "low": df["low"].to_numpy().astype(np.float64),
        "close": df["close"].to_numpy().astype(np.float64),
        "volume": df["volume"].to_numpy().astype(np.float64),
    }


# ── Volatility Clustering ───────────────────────────────────────────────────────

@_day_cached
def get_volatility_series(symbol: str) -> VolatilitySeriesResponse:
    arrs = _fetch_ohlcv_arrays(symbol)
    closes, dates = arrs["close"], arrs["dates"]
    if len(closes) < 41:
        raise ValueError(f"Not enough history for {symbol}")

    rets = np.diff(closes) / closes[:-1] * 100
    ret_dates = dates[1:]

    rv = (pl.Series(rets).rolling_std(window_size=20) * np.sqrt(252)).to_numpy()
    vov = pl.Series(rv).rolling_std(window_size=20).to_numpy()

    points: list[VolatilityPoint] = []
    for i in range(len(rets)):
        if np.isnan(rv[i]) or np.isnan(vov[i]):
            continue
        points.append(VolatilityPoint(
            date=str(ret_dates[i]),
            realized_vol_20d=round(float(rv[i]), 3),
            vol_of_vol_20d=round(float(vov[i]), 3),
        ))
    if not points:
        raise ValueError(f"Not enough history for {symbol}")

    vol_hist = np.array([p.realized_vol_20d for p in points])
    current_vol = float(vol_hist[-1])
    vol_percentile = round(float((vol_hist <= current_vol).mean() * 100), 1)

    return VolatilitySeriesResponse(
        symbol=symbol, series=points,
        current_vol=round(current_vol, 3), vol_percentile=vol_percentile,
    )


# ── Drawdown History (worst episodes) ──────────────────────────────────────────

@_day_cached
def get_drawdown_history(symbol: str) -> DrawdownHistoryResponse:
    arrs = _fetch_ohlcv_arrays(symbol)
    closes, dates = arrs["close"], arrs["dates"]
    n = len(closes)
    if n < 2:
        raise ValueError(f"Not enough history for {symbol}")

    dd = np.zeros(n)
    peak_track = np.zeros(n, dtype=int)
    peak, peak_idx = closes[0], 0
    for i, c in enumerate(closes):
        if c > peak:
            peak, peak_idx = c, i
        dd[i] = (c - peak) / peak * 100 if peak else 0.0
        peak_track[i] = peak_idx

    episodes: list[DrawdownEpisode] = []
    i = 0
    while i < n:
        if dd[i] < 0:
            j = i
            while j < n and dd[j] < 0:
                j += 1
            window = dd[i:j]
            trough_idx = i + int(np.argmin(window))
            start_idx = int(peak_track[trough_idx])
            recovered = j < n
            episodes.append(DrawdownEpisode(
                start_date=str(dates[start_idx]),
                trough_date=str(dates[trough_idx]),
                recovery_date=str(dates[j]) if recovered else None,
                depth_pct=round(float(dd[trough_idx]), 3),
                duration_days=trough_idx - start_idx,
                recovery_days=(j - trough_idx) if recovered else None,
            ))
            i = j
        else:
            i += 1

    episodes.sort(key=lambda e: e.depth_pct)
    return DrawdownHistoryResponse(symbol=symbol, episodes=episodes[:10])


# ── Seasonality ──────────────────────────────────────────────────────────────────

@_day_cached
def get_seasonality(symbol: str) -> SeasonalityResponse:
    arrs = _fetch_ohlcv_arrays(symbol)
    closes, dates = arrs["close"], arrs["dates"]
    if len(closes) < 30:
        raise ValueError(f"Not enough history for {symbol}")

    rets = np.diff(closes) / closes[:-1] * 100
    ret_dates = [datetime.strptime(str(d), "%Y-%m-%d") for d in dates[1:]]

    buckets: dict[tuple[int, int], list[float]] = {}
    for dt, r in zip(ret_dates, rets):
        dow = dt.weekday()
        if dow > 4:
            continue
        buckets.setdefault((dt.month, dow), []).append(float(r))

    grid = [
        SeasonalityCell(month=m, day_of_week=dow, avg_return_pct=round(float(np.mean(v)), 4), n=len(v))
        for (m, dow), v in buckets.items()
    ]

    month_vals: dict[int, list[float]] = {}
    for (m, dow), v in buckets.items():
        month_vals.setdefault(m, []).extend(v)
    month_means = {m: float(np.mean(v)) for m, v in month_vals.items()}
    best_month = max(month_means, key=lambda m: month_means[m])
    worst_month = min(month_means, key=lambda m: month_means[m])

    return SeasonalityResponse(symbol=symbol, grid=grid, best_month=best_month, worst_month=worst_month)


# ── Gap Analysis ─────────────────────────────────────────────────────────────────

@_day_cached
def get_gaps(symbol: str) -> GapsResponse:
    arrs = _fetch_ohlcv_arrays(symbol)
    opens, highs, lows, closes, dates = arrs["open"], arrs["high"], arrs["low"], arrs["close"], arrs["dates"]
    n = len(closes)
    if n < 2:
        raise ValueError(f"Not enough history for {symbol}")

    points: list[GapPoint] = []
    for i in range(1, n):
        prev_close = closes[i - 1]
        if not prev_close:
            continue
        gap_pct = (opens[i] - prev_close) / prev_close * 100
        if gap_pct > 0:
            filled = bool(lows[i] <= prev_close)
        elif gap_pct < 0:
            filled = bool(highs[i] >= prev_close)
        else:
            filled = True
        points.append(GapPoint(date=str(dates[i]), gap_pct=round(float(gap_pct), 3), filled=filled))

    edges = [0.0, 1.0, 2.0, 3.0, float("inf")]
    labels = ["0-1%", "1-2%", "2-3%", ">3%"]
    buckets: list[GapBucket] = []
    for lo, hi, label in zip(edges[:-1], edges[1:], labels):
        in_bucket = [p for p in points if lo <= abs(p.gap_pct) < hi]
        if not in_bucket:
            buckets.append(GapBucket(label=label, count=0, fill_rate_pct=0.0))
            continue
        fill_rate = sum(1 for p in in_bucket if p.filled) / len(in_bucket) * 100
        buckets.append(GapBucket(label=label, count=len(in_bucket), fill_rate_pct=round(fill_rate, 1)))

    overall = (sum(1 for p in points if p.filled) / len(points) * 100) if points else 0.0
    return GapsResponse(symbol=symbol, points=points, buckets=buckets, overall_fill_rate_pct=round(overall, 1))


# ── Volume Profile ───────────────────────────────────────────────────────────────

@_day_cached
def get_volume_profile(symbol: str, bars: int = 252, n_bins: int = 24) -> VolumeProfileResponse:
    arrs = _fetch_ohlcv_arrays(symbol)
    highs, lows, closes, volumes = arrs["high"], arrs["low"], arrs["close"], arrs["volume"]
    n = len(closes)
    if n < 2:
        raise ValueError(f"Not enough history for {symbol}")

    window = min(bars, n)
    h, l, c, v = highs[-window:], lows[-window:], closes[-window:], volumes[-window:]
    lo, hi = float(np.min(l)), float(np.max(h))
    if hi <= lo:
        raise ValueError(f"Degenerate price range for {symbol}")

    edges = np.linspace(lo, hi, n_bins + 1)
    typical = (h + l + c) / 3
    bin_idx = np.clip(np.digitize(typical, edges) - 1, 0, n_bins - 1)

    vol_per_bin = np.zeros(n_bins)
    for idx, vol in zip(bin_idx, v):
        vol_per_bin[idx] += vol

    bins = [
        VolumeProfileBin(
            price_low=round(float(edges[i]), 2),
            price_high=round(float(edges[i + 1]), 2),
            volume=int(vol_per_bin[i]),
        )
        for i in range(n_bins)
    ]
    poc_idx = int(np.argmax(vol_per_bin))
    poc = (edges[poc_idx] + edges[poc_idx + 1]) / 2
    return VolumeProfileResponse(symbol=symbol, bins=bins, point_of_control=round(float(poc), 2), lookback_bars=window)


# ── Autocorrelation ─────────────────────────────────────────────────────────────

@_day_cached
def get_autocorrelation(symbol: str, max_lag: int = 20) -> AutocorrelationResponse:
    arrs = _fetch_ohlcv_arrays(symbol)
    closes = arrs["close"]
    if len(closes) < max_lag + 30:
        raise ValueError(f"Not enough history for {symbol}")

    rets = np.diff(closes) / closes[:-1] * 100
    n = len(rets)
    mean = rets.mean()
    var = float(np.sum((rets - mean) ** 2))

    acf_points: list[ACFPoint] = []
    for lag in range(1, max_lag + 1):
        cov = float(np.sum((rets[:-lag] - mean) * (rets[lag:] - mean)))
        acf_val = cov / var if var else 0.0
        acf_points.append(ACFPoint(lag=lag, value=round(acf_val, 4)))

    band = round(1.96 / np.sqrt(n), 4)
    return AutocorrelationResponse(symbol=symbol, acf=acf_points, significance_band=band)


# ── Extreme Days ─────────────────────────────────────────────────────────────────

@_day_cached
def get_extreme_days(symbol: str) -> ExtremeDaysResponse:
    arrs = _fetch_ohlcv_arrays(symbol)
    closes, volumes, dates = arrs["close"], arrs["volume"], arrs["dates"]
    n = len(closes)
    if n < 25:
        raise ValueError(f"Not enough history for {symbol}")

    rets = np.diff(closes) / closes[:-1] * 100
    ret_dates = dates[1:]
    ret_volumes = volumes[1:]
    avg_vol_20 = pl.Series(volumes).rolling_mean(window_size=20).to_numpy()[1:]

    items: list[ExtremeDay] = []
    for i in range(len(rets)):
        avg_v = avg_vol_20[i]
        vol_ratio = float(ret_volumes[i] / avg_v) if avg_v and not np.isnan(avg_v) else 0.0
        items.append(ExtremeDay(
            date=str(ret_dates[i]),
            return_pct=round(float(rets[i]), 3),
            volume_ratio=round(vol_ratio, 2),
        ))

    items_sorted = sorted(items, key=lambda x: x.return_pct)
    worst = items_sorted[:15]
    best = list(reversed(items_sorted[-15:]))
    return ExtremeDaysResponse(symbol=symbol, best=best, worst=worst)


# ── Benchmark Comparison (last 5 days) ───────────────────────────────────────────

@_day_cached
def get_benchmark_comparison(symbol: str) -> BenchmarkComparisonResponse:
    from app.services import sector_heatmap_service as shs

    sector_name = shs.get_symbol_sector(symbol)
    sector_symbols = shs.get_sector_symbols(sector_name) if sector_name else []
    n50 = shs.get_universe_symbols("nifty50")
    n200 = shs.get_universe_symbols("nifty200")
    n500 = shs.get_universe_symbols("nifty500")

    all_symbols = list(set(n500) | set(sector_symbols) | {symbol})
    con = get_connection()
    placeholders = ",".join(["?" for _ in all_symbols])
    df = con.execute(
        f"""
        SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d, close
        FROM equities_prices
        WHERE symbol IN ({placeholders})
          AND CAST(date AS DATE) >= (CURRENT_DATE - INTERVAL 21 DAY)
        ORDER BY symbol, d
        """,
        all_symbols,
    ).pl()

    closes_map: dict[str, dict[str, float]] = {}
    for sym, d, close in df.iter_rows():
        closes_map.setdefault(sym, {})[d] = close

    if symbol not in closes_map or len(closes_map[symbol]) < 2:
        raise ValueError(f"Not enough recent data for {symbol}")

    trading_dates = sorted(closes_map[symbol].keys())[-6:]
    if len(trading_dates) < 2:
        raise ValueError(f"Not enough recent data for {symbol}")

    def daily_return(sym_closes: dict[str, float], d0: str, d1: str) -> float | None:
        c0, c1 = sym_closes.get(d0), sym_closes.get(d1)
        if c0 is None or c1 is None or c0 == 0:
            return None
        return (c1 - c0) / c0 * 100

    def group_return(symbols: list[str], d0: str, d1: str) -> float:
        vals = [r for s in symbols if (r := daily_return(closes_map.get(s, {}), d0, d1)) is not None]
        return round(float(np.mean(vals)), 3) if vals else 0.0

    days: list[BenchmarkDayComparison] = []
    for i in range(1, len(trading_dates)):
        d0, d1 = trading_dates[i - 1], trading_dates[i]
        stock_ret = daily_return(closes_map[symbol], d0, d1)
        if stock_ret is None:
            continue
        days.append(BenchmarkDayComparison(
            date=d1,
            stock_return_pct=round(stock_ret, 3),
            sector_return_pct=group_return(sector_symbols, d0, d1) if sector_symbols else 0.0,
            nifty50_return_pct=group_return(n50, d0, d1),
            nifty200_return_pct=group_return(n200, d0, d1),
            nifty500_return_pct=group_return(n500, d0, d1),
        ))

    return BenchmarkComparisonResponse(symbol=symbol, sector_name=sector_name, days=days[-5:])
