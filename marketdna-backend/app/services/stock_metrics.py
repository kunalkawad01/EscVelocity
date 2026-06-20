"""All metric calculations via DuckDB. No analytics in Python unless post-processing."""
import functools
import numpy as np
from datetime import date as _date
from typing import Any, Optional
from app.services.duckdb_client import get_connection

# ── Day-level result cache ────────────────────────────────────────────────────
# Keyed by (fn_name, today_str, *positional_args).
# Entries from previous days are evicted on first write of a new day.
_cache: dict[tuple, Any] = {}


def _day_cached(fn: Any) -> Any:
    """Decorator: cache results by (today, *args), evict yesterday's entries."""
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        today = str(_date.today())
        key = (fn.__name__, today) + args
        if key in _cache:
            return _cache[key]
        stale = [k for k in list(_cache) if k[1] != today]
        for k in stale:
            del _cache[k]
        result = fn(*args, **kwargs)
        _cache[key] = result
        return result
    return wrapper
from app.models.stock import (
    OHLCVResponse, Candle,
    RelativeStrengthResponse, RankPoint, RelativeStrengthStats,
    ReturnsResponse, ReturnHistogramBin, ReturnStats,
    RiskResponse, ATRPoint, RiskStats,
    DrawdownResponse, DrawdownPoint, DrawdownStats,
    MarketComparisonResponse, RatioPoint, MarketComparisonStats,
    PercentilesResponse, PercentileMetric,
    StockSummary,
    RegimePoint, RegimeStats, RegimeResponse,
    SMAStreak, TrendPersistenceResponse,
    Insight, InsightsResponse,
    AnalogSnapshot, AnalogPeriod, AnalogStats, AnalogResponse,
)


@_day_cached
def get_symbols() -> list[str]:
    con = get_connection()
    rows = con.execute("SELECT DISTINCT symbol FROM equities_prices ORDER BY symbol").fetchall()
    return [r[0] for r in rows]


def get_universe() -> list[str]:
    """Return full NSE 500 universe from DuckDB. Cached daily via get_symbols()."""
    return get_symbols()


@_day_cached
def get_ohlcv(symbol: str) -> OHLCVResponse:
    con = get_connection()
    df = con.execute(f"""
        WITH base AS (
            SELECT
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                ROUND(open, 2)  AS open,
                ROUND(high, 2)  AS high,
                ROUND(low, 2)   AS low,
                ROUND(close, 2) AS close,
                volume::BIGINT  AS volume,
                ROW_NUMBER() OVER (ORDER BY date) AS rn
            FROM equities_prices
            WHERE symbol = '{symbol}'
        ),
        sma AS (
            SELECT *,
                CASE WHEN rn >= 20  THEN ROUND(AVG(close) OVER (ORDER BY date ROWS BETWEEN 19  PRECEDING AND CURRENT ROW), 2) END AS sma20,
                CASE WHEN rn >= 50  THEN ROUND(AVG(close) OVER (ORDER BY date ROWS BETWEEN 49  PRECEDING AND CURRENT ROW), 2) END AS sma50,
                CASE WHEN rn >= 200 THEN ROUND(AVG(close) OVER (ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW), 2) END AS sma200,
                ROUND((close - LAG(close,1) OVER (ORDER BY date)) / NULLIF(LAG(close,1) OVER (ORDER BY date), 0) * 100, 4) AS daily_return_pct
            FROM base
        )
        SELECT date, open, high, low, close, volume, sma20, sma50, sma200, daily_return_pct
        FROM sma ORDER BY date
    """).pl()

    candles = [Candle(**row) for row in df.to_dicts()]
    return OHLCVResponse(symbol=symbol, candles=candles)


@_day_cached
def get_relative_strength(symbol: str) -> RelativeStrengthResponse:
    con = get_connection()
    df = con.execute(f"""
        WITH ret20 AS (
            SELECT symbol, CAST(date AS DATE) AS date,
                ROUND(
                    (close - LAG(close, 20) OVER (PARTITION BY symbol ORDER BY date))
                    / NULLIF(LAG(close, 20) OVER (PARTITION BY symbol ORDER BY date), 0) * 100,
                4) AS return_20d
            FROM equities_prices
        ),
        valid AS (
            SELECT date, symbol, return_20d
            FROM ret20
            WHERE return_20d IS NOT NULL
        ),
        ranked AS (
            SELECT date, symbol, return_20d,
                RANK() OVER (PARTITION BY date ORDER BY return_20d DESC)::INT AS rank,
                COUNT(*) OVER (PARTITION BY date)::INT AS total
            FROM valid
        )
        SELECT STRFTIME('%Y-%m-%d', date) AS date, rank, total
        FROM ranked
        WHERE symbol = '{symbol}'
        ORDER BY date
    """).pl()

    rows = df.to_dicts()
    if not rows:
        return RelativeStrengthResponse(
            symbol=symbol,
            ranks=[],
            stats=RelativeStrengthStats(
                current_rank=0, best_rank=0, worst_rank=0,
                avg_rank=0.0, rank_percentile=0.0, total_symbols=0
            ),
        )

    ranks = [
        RankPoint(
            date=r["date"],
            rank=r["rank"],
            total=r["total"],
            percentile=round((r["total"] - r["rank"]) / max(r["total"] - 1, 1) * 100, 1),
        )
        for r in rows
    ]

    last = rows[-1]
    all_ranks = [r["rank"] for r in rows]
    avg = round(float(np.mean(all_ranks)), 1)
    current_pct = round((last["total"] - last["rank"]) / max(last["total"] - 1, 1) * 100, 1)

    stats = RelativeStrengthStats(
        current_rank=last["rank"],
        best_rank=int(min(all_ranks)),
        worst_rank=int(max(all_ranks)),
        avg_rank=avg,
        rank_percentile=current_pct,
        total_symbols=last["total"],
    )
    return RelativeStrengthResponse(symbol=symbol, ranks=ranks, stats=stats)


def _make_histogram(values: list[float], bins: int = 30) -> list[ReturnHistogramBin]:
    if not values:
        return []
    arr = np.array(values)
    counts, edges = np.histogram(arr, bins=bins)
    return [
        ReturnHistogramBin(
            bin_start=round(float(edges[i]), 4),
            bin_end=round(float(edges[i + 1]), 4),
            count=int(counts[i]),
        )
        for i in range(len(counts))
    ]


def _return_stats(values: list[float]) -> ReturnStats:
    arr = np.array(values)
    return ReturnStats(
        mean=round(float(np.mean(arr)), 4),
        median=round(float(np.median(arr)), 4),
        std=round(float(np.std(arr)), 4),
        p5=round(float(np.percentile(arr, 5)), 4),
        p95=round(float(np.percentile(arr, 95)), 4),
        max_val=round(float(np.max(arr)), 4),
        min_val=round(float(np.min(arr)), 4),
    )


@_day_cached
def get_returns(symbol: str) -> ReturnsResponse:
    con = get_connection()

    # Daily returns
    df_daily = con.execute(f"""
        SELECT
            ROUND((close - LAG(close,1) OVER (ORDER BY date)) / NULLIF(LAG(close,1) OVER (ORDER BY date), 0) * 100, 4) AS ret
        FROM equities_prices
        WHERE symbol = '{symbol}'
        ORDER BY date
    """).pl()
    daily_vals = [r for r in df_daily["ret"].to_list() if r is not None]

    # Monthly returns
    df_monthly = con.execute(f"""
        WITH monthly AS (
            SELECT DATE_TRUNC('month', CAST(date AS DATE)) AS month,
                FIRST(close ORDER BY date) AS first_close,
                LAST(close ORDER BY date)  AS last_close
            FROM equities_prices
            WHERE symbol = '{symbol}'
            GROUP BY month
        )
        SELECT
            STRFTIME('%Y-%m', month) AS period,
            ROUND((last_close - first_close) / NULLIF(first_close, 0) * 100, 3) AS return_pct
        FROM monthly
        ORDER BY month
    """).pl()
    monthly_rows = df_monthly.to_dicts()
    monthly_vals = [r["return_pct"] for r in monthly_rows if r["return_pct"] is not None]

    # Yearly returns
    df_yearly = con.execute(f"""
        WITH yearly AS (
            SELECT YEAR(CAST(date AS DATE)) AS yr,
                FIRST(close ORDER BY date) AS first_close,
                LAST(close ORDER BY date)  AS last_close
            FROM equities_prices
            WHERE symbol = '{symbol}'
            GROUP BY yr
        )
        SELECT
            yr::VARCHAR AS period,
            ROUND((last_close - first_close) / NULLIF(first_close, 0) * 100, 2) AS return_pct
        FROM yearly
        ORDER BY yr
    """).pl()
    yearly_rows = df_yearly.to_dicts()
    yearly_vals = [r["return_pct"] for r in yearly_rows if r["return_pct"] is not None]

    return ReturnsResponse(
        symbol=symbol,
        daily_histogram=_make_histogram(daily_vals),
        daily_stats=_return_stats(daily_vals),
        monthly_histogram=_make_histogram(monthly_vals, bins=20) if monthly_vals else [],
        monthly_returns=monthly_rows,
        monthly_stats=_return_stats(monthly_vals) if monthly_vals else _return_stats([0]),
        yearly_returns=yearly_rows,
        yearly_stats=_return_stats(yearly_vals) if yearly_vals else _return_stats([0]),
    )


@_day_cached
def get_risk(symbol: str) -> RiskResponse:
    con = get_connection()
    df = con.execute(f"""
        WITH prices AS (
            SELECT
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                high, low, close,
                LAG(close,1) OVER (ORDER BY date) AS prev_close
            FROM equities_prices
            WHERE symbol = '{symbol}'
            ORDER BY date
        ),
        tr AS (
            SELECT date, close,
                GREATEST(high - low,
                         ABS(high - COALESCE(prev_close, close)),
                         ABS(low  - COALESCE(prev_close, close))) AS true_range
            FROM prices
            WHERE prev_close IS NOT NULL
        )
        SELECT date, close,
            ROUND(AVG(true_range) OVER (ORDER BY date ROWS BETWEEN 13 PRECEDING AND CURRENT ROW), 2) AS atr14
        FROM tr
        ORDER BY date
    """).pl()

    rows = df.to_dicts()
    if not rows:
        return RiskResponse(
            symbol=symbol,
            atr_series=[],
            stats=RiskStats(current_atr=0, atr_percentile=0, atr_trend="neutral", close=0, atr_pct_of_price=0),
        )

    atr_series = [ATRPoint(date=r["date"], atr14=r["atr14"]) for r in rows if r["atr14"] is not None]
    atr_vals = [p.atr14 for p in atr_series]

    current_atr = atr_vals[-1]
    current_close = rows[-1]["close"]
    atr_pct = round(float(np.mean(np.array(atr_vals) <= current_atr) * 100), 1)

    recent = atr_vals[-10:] if len(atr_vals) >= 10 else atr_vals
    older = atr_vals[-20:-10] if len(atr_vals) >= 20 else atr_vals[:max(1, len(atr_vals)//2)]
    trend = "neutral"
    if np.mean(recent) > np.mean(older) * 1.05:
        trend = "rising"
    elif np.mean(recent) < np.mean(older) * 0.95:
        trend = "falling"

    stats = RiskStats(
        current_atr=round(current_atr, 2),
        atr_percentile=atr_pct,
        atr_trend=trend,
        close=round(current_close, 2),
        atr_pct_of_price=round(current_atr / current_close * 100, 2) if current_close else 0,
    )
    return RiskResponse(symbol=symbol, atr_series=atr_series, stats=stats)


@_day_cached
def get_drawdown(symbol: str) -> DrawdownResponse:
    con = get_connection()
    df = con.execute(f"""
        SELECT
            STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
            close
        FROM equities_prices
        WHERE symbol = '{symbol}'
          AND CAST(date AS DATE) >= (CURRENT_DATE - INTERVAL 5 YEAR)
        ORDER BY date
    """).pl()

    rows = df.to_dicts()
    closes = [r["close"] for r in rows]
    dates = [r["date"] for r in rows]

    peak = closes[0]
    dd_series = []
    for i, c in enumerate(closes):
        if c > peak:
            peak = c
        dd_pct = round((c - peak) / peak * 100, 4) if peak else 0
        dd_series.append(DrawdownPoint(date=dates[i], drawdown_pct=dd_pct))

    dd_vals = [p.drawdown_pct for p in dd_series]
    days_underwater = sum(1 for v in dd_vals if v < 0)

    # Average recovery time: days from drawdown trough to next full recovery (dd=0)
    recoveries: list[int] = []
    i = 0
    n = len(dd_vals)
    while i < n:
        if dd_vals[i] < 0:
            j = i
            while j < n and dd_vals[j] < 0:
                j += 1
            period = dd_vals[i:j]
            trough_abs = i + period.index(min(period))
            if j < n:
                recoveries.append(j - trough_abs)
            i = j
        else:
            i += 1
    avg_recovery_days = int(round(np.mean(recoveries))) if recoveries else 0

    stats = DrawdownStats(
        current_drawdown=round(dd_vals[-1], 4) if dd_vals else 0,
        max_drawdown=round(min(dd_vals), 4) if dd_vals else 0,
        avg_drawdown=round(float(np.mean([v for v in dd_vals if v < 0] or [0])), 4),
        days_underwater=days_underwater,
        total_days=len(dd_vals),
        avg_recovery_days=avg_recovery_days,
    )
    return DrawdownResponse(symbol=symbol, drawdowns=dd_series, stats=stats)


@_day_cached
def get_market_comparison(symbol: str) -> MarketComparisonResponse:
    con = get_connection()

    # Build equal-weighted NIFTY composite: average normalised close across all symbols
    df = con.execute(f"""
        WITH stock AS (
            SELECT
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                close AS stock_close
            FROM equities_prices
            WHERE symbol = '{symbol}'
        ),
        index_base AS (
            SELECT
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                AVG(close) AS idx_close
            FROM equities_prices
            GROUP BY date
        ),
        joined AS (
            SELECT s.date,
                s.stock_close,
                i.idx_close,
                ROUND(s.stock_close / NULLIF(i.idx_close, 0), 6) AS ratio
            FROM stock s JOIN index_base i ON s.date = i.date
        ),
        rn AS (
            SELECT *, ROW_NUMBER() OVER (ORDER BY date) AS rn
            FROM joined
        )
        SELECT date, ratio,
            CASE WHEN rn >= 50  THEN ROUND(AVG(ratio) OVER (ORDER BY date ROWS BETWEEN 49  PRECEDING AND CURRENT ROW), 6) END AS sma50,
            CASE WHEN rn >= 200 THEN ROUND(AVG(ratio) OVER (ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW), 6) END AS sma200
        FROM rn ORDER BY date
    """).pl()

    rows = df.to_dicts()
    ratio_series = [
        RatioPoint(date=r["date"], ratio=r["ratio"], sma50=r["sma50"], sma200=r["sma200"])
        for r in rows
    ]

    if not rows:
        return MarketComparisonResponse(
            symbol=symbol,
            ratio_series=[],
            stats=MarketComparisonStats(current_ratio=0, ratio_change_1y=0, status="Neutral"),
        )

    current_ratio = rows[-1]["ratio"]
    one_year_ago = rows[-252]["ratio"] if len(rows) >= 252 else rows[0]["ratio"]
    ratio_change_1y = round((current_ratio - one_year_ago) / one_year_ago * 100, 2) if one_year_ago else 0

    status = "Neutral"
    if ratio_change_1y > 5:
        status = "Outperforming"
    elif ratio_change_1y < -5:
        status = "Underperforming"

    stats = MarketComparisonStats(
        current_ratio=round(current_ratio, 6),
        ratio_change_1y=ratio_change_1y,
        status=status,
    )
    return MarketComparisonResponse(symbol=symbol, ratio_series=ratio_series, stats=stats)


@_day_cached
def get_percentiles(symbol: str) -> PercentilesResponse:
    con = get_connection()

    df = con.execute(f"""
        WITH base AS (
            SELECT
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                close, high, low, volume,
                LAG(close,1)  OVER (ORDER BY date) AS prev_close,
                LAG(close,20) OVER (ORDER BY date) AS close_20d,
                LAG(close,63) OVER (ORDER BY date) AS close_3m,
                LAG(close,252) OVER (ORDER BY date) AS close_1y
            FROM equities_prices
            WHERE symbol = '{symbol}'
            ORDER BY date
        ),
        tr AS (
            SELECT date, close, volume,
                (close - COALESCE(prev_close, close)) / NULLIF(COALESCE(prev_close, close), 0) * 100 AS daily_ret,
                (close - COALESCE(close_20d, close)) / NULLIF(COALESCE(close_20d, close), 0) * 100 AS ret_1m,
                (close - COALESCE(close_3m, close)) / NULLIF(COALESCE(close_3m, close), 0) * 100 AS ret_3m,
                (close - COALESCE(close_1y, close)) / NULLIF(COALESCE(close_1y, close), 0) * 100 AS ret_1y,
                GREATEST(high - low,
                         ABS(high - COALESCE(prev_close, close)),
                         ABS(low  - COALESCE(prev_close, close))) AS true_range
            FROM base WHERE prev_close IS NOT NULL
        ),
        atr AS (
            SELECT date, close, volume, daily_ret, ret_1m, ret_3m, ret_1y,
                AVG(true_range) OVER (ORDER BY date ROWS BETWEEN 13 PRECEDING AND CURRENT ROW) AS atr14
            FROM tr
        )
        SELECT * FROM atr ORDER BY date
    """).pl()

    rows = df.to_dicts()
    if not rows:
        return PercentilesResponse(symbol=symbol, metrics=[])

    last = rows[-1]

    def pct_rank(values: list, current) -> float:
        clean = [v for v in values if v is not None]
        if not clean:
            return 0.0
        return round(float(np.mean(np.array(clean) <= current) * 100), 1)

    atrs = [r["atr14"] for r in rows if r["atr14"] is not None]
    vols = [r["volume"] for r in rows if r["volume"] is not None]
    daily_rets = [r["daily_ret"] for r in rows if r["daily_ret"] is not None]
    ret_1m = [r["ret_1m"] for r in rows if r["ret_1m"] is not None]
    ret_3m = [r["ret_3m"] for r in rows if r["ret_3m"] is not None]
    ret_1y = [r["ret_1y"] for r in rows if r["ret_1y"] is not None]

    metrics = [
        PercentileMetric(metric="ATR(14)", current_value=round(last["atr14"] or 0, 2), unit="₹", percentile=pct_rank(atrs, last["atr14"]), label="Volatility"),
        PercentileMetric(metric="Volume", current_value=round((last["volume"] or 0) / 1e6, 2), unit="M", percentile=pct_rank(vols, last["volume"]), label="Liquidity"),
        PercentileMetric(metric="Daily Return", current_value=round(last["daily_ret"] or 0, 2), unit="%", percentile=pct_rank(daily_rets, last["daily_ret"]), label="Today"),
        PercentileMetric(metric="1-Month Return", current_value=round(last["ret_1m"] or 0, 2), unit="%", percentile=pct_rank(ret_1m, last["ret_1m"]), label="Momentum"),
        PercentileMetric(metric="3-Month Return", current_value=round(last["ret_3m"] or 0, 2), unit="%", percentile=pct_rank(ret_3m, last["ret_3m"]), label="Trend"),
        PercentileMetric(metric="1-Year Return", current_value=round(last["ret_1y"] or 0, 2), unit="%", percentile=pct_rank(ret_1y, last["ret_1y"]), label="Annual"),
    ]
    return PercentilesResponse(symbol=symbol, metrics=metrics)


@_day_cached
def get_regime(symbol: str) -> RegimeResponse:
    con = get_connection()
    df = con.execute(f"""
        WITH base AS (
            SELECT
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                close,
                ROW_NUMBER() OVER (ORDER BY date) AS rn
            FROM equities_prices
            WHERE symbol = '{symbol}'
        ),
        sma AS (
            SELECT *,
                CASE WHEN rn >= 20  THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 19  PRECEDING AND CURRENT ROW) END AS sma20,
                CASE WHEN rn >= 50  THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 49  PRECEDING AND CURRENT ROW) END AS sma50,
                CASE WHEN rn >= 100 THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 99  PRECEDING AND CURRENT ROW) END AS sma100,
                CASE WHEN rn >= 200 THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) END AS sma200
            FROM base
        )
        SELECT date,
            (CASE WHEN sma20  IS NOT NULL AND close > sma20  THEN 1 ELSE 0 END +
             CASE WHEN sma50  IS NOT NULL AND close > sma50  THEN 1 ELSE 0 END +
             CASE WHEN sma100 IS NOT NULL AND close > sma100 THEN 1 ELSE 0 END +
             CASE WHEN sma200 IS NOT NULL AND close > sma200 THEN 1 ELSE 0 END) AS score
        FROM sma
        WHERE rn >= 20
        ORDER BY date
    """).pl()

    def _score_to_regime(s: int) -> str:
        if s >= 4: return 'Super Bull'
        if s >= 3: return 'Bull'
        if s >= 2: return 'Neutral'
        return 'Bear'

    rows = df.to_dicts()
    if not rows:
        return RegimeResponse(
            symbol=symbol,
            timeline=[],
            stats=RegimeStats(current_regime='Bear', prev_regime='Bear', days_in_regime=0, regime_strength=0.0),
        )

    timeline = [RegimePoint(date=r['date'], regime=_score_to_regime(r['score']), score=r['score']) for r in rows]
    current = timeline[-1]
    prev_regime = timeline[-2].regime if len(timeline) >= 2 else current.regime

    days = 1
    for t in reversed(timeline[:-1]):
        if t.regime == current.regime:
            days += 1
        else:
            break

    recent = [t.regime for t in timeline[-20:]]
    strength = round(recent.count(current.regime) / len(recent) * 100, 1) if recent else 0.0

    return RegimeResponse(
        symbol=symbol,
        timeline=timeline,
        stats=RegimeStats(
            current_regime=current.regime,
            prev_regime=prev_regime,
            days_in_regime=days,
            regime_strength=strength,
        ),
    )


@_day_cached
def get_trend_persistence(symbol: str) -> TrendPersistenceResponse:
    con = get_connection()
    df = con.execute(f"""
        WITH base AS (
            SELECT
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                close,
                ROW_NUMBER() OVER (ORDER BY date) AS rn
            FROM equities_prices
            WHERE symbol = '{symbol}'
        ),
        sma AS (
            SELECT *,
                CASE WHEN rn >= 20  THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 19  PRECEDING AND CURRENT ROW) END AS sma20,
                CASE WHEN rn >= 50  THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 49  PRECEDING AND CURRENT ROW) END AS sma50,
                CASE WHEN rn >= 200 THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) END AS sma200
            FROM base
        )
        SELECT date,
            CASE WHEN sma20  IS NOT NULL AND close > sma20  THEN 1 ELSE 0 END AS above20,
            CASE WHEN sma50  IS NOT NULL AND close > sma50  THEN 1 ELSE 0 END AS above50,
            CASE WHEN sma200 IS NOT NULL AND close > sma200 THEN 1 ELSE 0 END AS above200
        FROM sma
        WHERE rn >= 20
        ORDER BY date
    """).pl()

    rows = df.to_dicts()

    def _streak_info(vals: list[int]) -> tuple[int, str, float]:
        if not vals:
            return 0, 'above', 50.0
        current_val = vals[-1]
        count = 1
        for v in reversed(vals[:-1]):
            if v == current_val:
                count += 1
            else:
                break
        # Percentile: what fraction of historical same-direction streaks were <= this length
        streaks: list[int] = []
        run = 1
        for i in range(1, len(vals)):
            if vals[i] == vals[i - 1]:
                run += 1
            else:
                streaks.append(run)
                run = 1
        streaks.append(run)
        pct = round(float(np.mean(np.array(streaks) <= count) * 100), 1) if streaks else 50.0
        return count, ('above' if current_val == 1 else 'below'), pct

    a20 = [r['above20'] for r in rows]
    a50 = [r['above50'] for r in rows]
    a200 = [r['above200'] for r in rows]

    s20, d20, p20 = _streak_info(a20)
    s50, d50, p50 = _streak_info(a50)
    s200, d200, p200 = _streak_info(a200)

    return TrendPersistenceResponse(
        symbol=symbol,
        streaks=[
            SMAStreak(label='SMA20',  current_streak=s20,  streak_direction=d20,  streak_percentile=p20),
            SMAStreak(label='SMA50',  current_streak=s50,  streak_direction=d50,  streak_percentile=p50),
            SMAStreak(label='SMA200', current_streak=s200, streak_direction=d200, streak_percentile=p200),
        ],
    )


@_day_cached
def get_analogs(symbol: str, top_n: int = 5) -> AnalogResponse:
    """
    Find the N most similar historical environments to today.

    Algorithm:
    1. For every trading day with enough history (200+ bars back, 126+ bars forward),
       compute 5 normalised features: regime score, 1M return, 3M return, drawdown, ATR.
    2. Normalise each feature globally to [0, 1] using min-max scaling.
    3. Compute the weighted Manhattan distance between today's feature vector and
       every historical date's vector.
    4. Pick the top N dates that are at least 21 trading days apart (no overlap).
    5. Return each analog's date, similarity score, and forward 1M/3M/6M returns.
    """
    con = get_connection()

    df = con.execute(f"""
        WITH base AS (
            SELECT
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                close, high, low,
                ROW_NUMBER() OVER (ORDER BY date) AS rn
            FROM equities_prices
            WHERE symbol = '{symbol}'
        ),
        calcs AS (
            SELECT date, close, rn,
                CASE WHEN rn >= 20  THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 19  PRECEDING AND CURRENT ROW) END AS sma20,
                CASE WHEN rn >= 50  THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 49  PRECEDING AND CURRENT ROW) END AS sma50,
                CASE WHEN rn >= 100 THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 99  PRECEDING AND CURRENT ROW) END AS sma100,
                CASE WHEN rn >= 200 THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) END AS sma200,
                MAX(close) OVER (ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS peak,
                LAG(close, 20)  OVER (ORDER BY date) AS close_20d,
                LAG(close, 63)  OVER (ORDER BY date) AS close_3m,
                GREATEST(high - low,
                         ABS(high - COALESCE(LAG(close,1) OVER (ORDER BY date), close)),
                         ABS(low  - COALESCE(LAG(close,1) OVER (ORDER BY date), close))) AS tr,
                LEAD(close, 21)  OVER (ORDER BY date) AS fwd_1m_close,
                LEAD(close, 63)  OVER (ORDER BY date) AS fwd_3m_close,
                LEAD(close, 126) OVER (ORDER BY date) AS fwd_6m_close
            FROM base
        )
        SELECT
            date, close, rn,
            (CASE WHEN sma20  IS NOT NULL AND close > sma20  THEN 1 ELSE 0 END +
             CASE WHEN sma50  IS NOT NULL AND close > sma50  THEN 1 ELSE 0 END +
             CASE WHEN sma100 IS NOT NULL AND close > sma100 THEN 1 ELSE 0 END +
             CASE WHEN sma200 IS NOT NULL AND close > sma200 THEN 1 ELSE 0 END)::FLOAT AS regime_score,
            CASE WHEN close_20d IS NOT NULL
                 THEN (close - close_20d) / NULLIF(close_20d, 0) * 100 END AS ret_1m,
            CASE WHEN close_3m IS NOT NULL
                 THEN (close - close_3m) / NULLIF(close_3m, 0) * 100 END AS ret_3m,
            (close - peak) / NULLIF(peak, 0) * 100 AS drawdown,
            AVG(tr) OVER (ORDER BY date ROWS BETWEEN 13 PRECEDING AND CURRENT ROW) AS atr14,
            CASE WHEN fwd_1m_close IS NOT NULL
                 THEN (fwd_1m_close - close) / NULLIF(close, 0) * 100 END AS fwd_1m,
            CASE WHEN fwd_3m_close IS NOT NULL
                 THEN (fwd_3m_close - close) / NULLIF(close, 0) * 100 END AS fwd_3m,
            CASE WHEN fwd_6m_close IS NOT NULL
                 THEN (fwd_6m_close - close) / NULLIF(close, 0) * 100 END AS fwd_6m
        FROM calcs
        WHERE rn >= 200 AND close_20d IS NOT NULL
        ORDER BY date
    """).pl()

    rows = df.to_dicts()
    if len(rows) < 60:
        empty_stats = AnalogStats(avg_fwd_1m=0, avg_fwd_3m=0, avg_fwd_6m=0,
                                  pct_positive_1m=0, pct_positive_3m=0)
        last = rows[-1] if rows else {}
        snap = AnalogSnapshot(
            regime='Bear', regime_score=0, ret_1m=0, ret_3m=None, drawdown=0, atr14=0,
        )
        return AnalogResponse(symbol=symbol, current_snapshot=snap, analogs=[], stats=empty_stats)

    # ── Build feature arrays ───────────────────────────────────────────────────
    regime_arr   = np.array([r['regime_score'] for r in rows], dtype=float)
    ret_1m_arr   = np.array([r['ret_1m'] for r in rows], dtype=float)
    ret_3m_arr   = np.array([r['ret_3m'] if r['ret_3m'] is not None else 0.0 for r in rows], dtype=float)
    drawdown_arr = np.array([r['drawdown'] for r in rows], dtype=float)
    atr_arr      = np.array([r['atr14'] for r in rows], dtype=float)

    # ── Min-max normalise to [0, 1] globally ──────────────────────────────────
    def _norm(arr: np.ndarray) -> np.ndarray:
        mn, mx = arr.min(), arr.max()
        return (arr - mn) / (mx - mn) if mx != mn else np.zeros_like(arr)

    regime_n   = _norm(regime_arr)
    ret_1m_n   = _norm(ret_1m_arr)
    ret_3m_n   = _norm(ret_3m_arr)
    drawdown_n = _norm(drawdown_arr)
    atr_n      = _norm(atr_arr)

    # Current (latest row) position in normalised space
    cur_i = len(rows) - 1
    cur = np.array([regime_n[cur_i], ret_1m_n[cur_i], ret_3m_n[cur_i],
                    drawdown_n[cur_i], atr_n[cur_i]])

    # ── Weights (must sum to 1.0) ──────────────────────────────────────────────
    W = np.array([0.25, 0.25, 0.15, 0.20, 0.15])

    # ── Compute weighted Manhattan distance for every candidate date ───────────
    # Candidates must have 6M of forward data → exclude last 126 rows
    # Candidates must be at least 126 bars before today → exclude last 126 rows as analogs
    candidate_end = max(0, len(rows) - 126)
    hist = np.column_stack([regime_n[:candidate_end], ret_1m_n[:candidate_end],
                            ret_3m_n[:candidate_end], drawdown_n[:candidate_end],
                            atr_n[:candidate_end]])
    distances = np.dot(np.abs(hist - cur), W)         # weighted Manhattan distance

    # ── Pick top N with minimum 21-day gap between picks ──────────────────────
    sorted_indices = np.argsort(distances)
    selected: list[int] = []
    last_idx = -999
    for idx in sorted_indices:
        if abs(int(idx) - last_idx) >= 21:
            selected.append(int(idx))
            last_idx = int(idx)
        if len(selected) >= top_n:
            break

    def _regime_name(score: float) -> str:
        s = int(round(score))
        if s >= 4: return 'Super Bull'
        if s >= 3: return 'Bull'
        if s >= 2: return 'Neutral'
        return 'Bear'

    # ── Build analog period objects ────────────────────────────────────────────
    analogs: list[AnalogPeriod] = []
    for idx in selected:
        r = rows[idx]
        sim = round(float((1 - distances[idx]) * 100), 1)
        analogs.append(AnalogPeriod(
            date=r['date'],
            similarity=sim,
            regime=_regime_name(r['regime_score']),
            drawdown=round(float(r['drawdown']), 2),
            ret_1m=round(float(r['ret_1m']), 2),
            fwd_1m=round(float(r['fwd_1m']), 2) if r['fwd_1m'] is not None else None,
            fwd_3m=round(float(r['fwd_3m']), 2) if r['fwd_3m'] is not None else None,
            fwd_6m=round(float(r['fwd_6m']), 2) if r['fwd_6m'] is not None else None,
        ))

    # Sort by similarity descending
    analogs.sort(key=lambda a: -a.similarity)

    # ── Aggregate stats ────────────────────────────────────────────────────────
    def _mean(vals: list[float]) -> float:
        return round(float(np.mean(vals)), 2) if vals else 0.0

    def _pct_pos(vals: list[float]) -> float:
        return round(float(np.mean(np.array(vals) > 0) * 100), 1) if vals else 0.0

    fwd1 = [a.fwd_1m for a in analogs if a.fwd_1m is not None]
    fwd3 = [a.fwd_3m for a in analogs if a.fwd_3m is not None]
    fwd6 = [a.fwd_6m for a in analogs if a.fwd_6m is not None]

    # ── Current snapshot ───────────────────────────────────────────────────────
    last = rows[-1]
    snapshot = AnalogSnapshot(
        regime=_regime_name(last['regime_score']),
        regime_score=int(last['regime_score']),
        ret_1m=round(float(last['ret_1m']), 2),
        ret_3m=round(float(last['ret_3m']), 2) if last['ret_3m'] is not None else None,
        drawdown=round(float(last['drawdown']), 2),
        atr14=round(float(last['atr14']), 2),
    )

    return AnalogResponse(
        symbol=symbol,
        current_snapshot=snapshot,
        analogs=analogs,
        stats=AnalogStats(
            avg_fwd_1m=_mean(fwd1),
            avg_fwd_3m=_mean(fwd3),
            avg_fwd_6m=_mean(fwd6),
            pct_positive_1m=_pct_pos(fwd1),
            pct_positive_3m=_pct_pos(fwd3),
        ),
    )


@_day_cached
def get_insights(symbol: str) -> InsightsResponse:
    from datetime import datetime

    # Pull all needed metrics in two focused queries instead of calling 5 service
    # functions (each of which would spawn its own DuckDB query on first load).
    con = get_connection()

    # Query 1: per-symbol metrics (SMA regime, ATR, returns, drawdown).
    # Each percentile CTE aggregates to exactly 1 row so the final cross-join is 1×1×1×1×1.
    df = con.execute(f"""
        WITH base AS (
            SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                close, high, low,
                ROW_NUMBER() OVER (ORDER BY date) AS rn
            FROM equities_prices WHERE symbol = '{symbol}'
        ),
        calcs AS (
            SELECT date, close, rn,
                CASE WHEN rn >= 20  THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 19  PRECEDING AND CURRENT ROW) END AS sma20,
                CASE WHEN rn >= 50  THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 49  PRECEDING AND CURRENT ROW) END AS sma50,
                CASE WHEN rn >= 200 THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) END AS sma200,
                LAG(close, 20)  OVER (ORDER BY date) AS close_20d,
                LAG(close, 252) OVER (ORDER BY date) AS close_1y,
                GREATEST(high - low,
                    ABS(high - COALESCE(LAG(close,1) OVER (ORDER BY date), close)),
                    ABS(low  - COALESCE(LAG(close,1) OVER (ORDER BY date), close))) AS tr,
                MAX(close) OVER (ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS peak
            FROM base
        ),
        with_atr AS (
            SELECT *,
                AVG(tr) OVER (ORDER BY date ROWS BETWEEN 13 PRECEDING AND CURRENT ROW) AS atr14,
                (close - peak) / NULLIF(peak, 0) * 100 AS dd_pct,
                (close - close_20d) / NULLIF(close_20d, 0) * 100 AS ret_1m,
                (close - close_1y)  / NULLIF(close_1y,  0) * 100 AS ret_1y
            FROM calcs
        ),
        latest AS (SELECT * FROM with_atr ORDER BY date DESC LIMIT 1),
        atr_pct   AS (SELECT ROUND(AVG(CAST(atr14 <= (SELECT atr14 FROM latest) AS INTEGER)) * 100, 1) AS pct FROM with_atr WHERE atr14 IS NOT NULL),
        ret1m_pct AS (SELECT ROUND(AVG(CAST(ret_1m <= (SELECT ret_1m FROM latest) AS INTEGER)) * 100, 1) AS pct FROM with_atr WHERE ret_1m IS NOT NULL),
        ret1y_pct AS (SELECT ROUND(AVG(CAST(ret_1y <= (SELECT ret_1y FROM latest) AS INTEGER)) * 100, 1) AS pct FROM with_atr WHERE ret_1y IS NOT NULL),
        dd_stats  AS (SELECT MIN(dd_pct) AS max_dd FROM with_atr)
        SELECT
            l.sma20  IS NOT NULL AND l.close > l.sma20  AS above20,
            l.sma50  IS NOT NULL AND l.close > l.sma50  AS above50,
            l.sma200 IS NOT NULL AND l.close > l.sma200 AS above200,
            l.atr14,
            l.dd_pct   AS current_dd,
            d.max_dd,
            l.ret_1m   AS cur_ret_1m,
            l.ret_1y   AS cur_ret_1y,
            a.pct      AS atr_pct,
            m.pct      AS ret_1m_pct,
            y.pct      AS ret_1y_pct
        FROM latest l, atr_pct a, ret1m_pct m, ret1y_pct y, dd_stats d
    """).fetchone()

    above20  = bool(df[0])
    above50  = bool(df[1])
    above200 = bool(df[2])
    # df indices: [3]=atr14, [4]=current_dd, [5]=max_dd, [6]=cur_ret_1m,
    #             [7]=cur_ret_1y, [8]=atr_pct, [9]=ret_1m_pct, [10]=ret_1y_pct
    current_dd     = float(df[4] or 0)
    max_dd         = float(df[5] or 0)
    cur_ret_1m     = float(df[6] or 0)
    cur_ret_1y     = float(df[7] or 0)
    atr_percentile = float(df[8] or 0)
    ret_1m_pct     = float(df[9] or 0)
    ret_1y_pct     = float(df[10] or 0)

    # Query 2: cross-sectional RS rank (needs all symbols — single query)
    rs_row = con.execute(f"""
        WITH latest_date AS (
            SELECT MAX(CAST(date AS DATE)) AS dt FROM equities_prices WHERE symbol = '{symbol}'
        ),
        ret20 AS (
            SELECT symbol,
                (close - LAG(close, 20) OVER (PARTITION BY symbol ORDER BY date))
                / NULLIF(LAG(close, 20) OVER (PARTITION BY symbol ORDER BY date), 0) * 100 AS ret_20d,
                CAST(date AS DATE) AS dt
            FROM equities_prices
        ),
        on_date AS (
            SELECT r.symbol, r.ret_20d
            FROM ret20 r INNER JOIN latest_date l ON r.dt = l.dt
            WHERE r.ret_20d IS NOT NULL
        ),
        ranked AS (
            SELECT symbol,
                RANK() OVER (ORDER BY ret_20d DESC)::INT AS rank,
                COUNT(*) OVER ()::INT AS total
            FROM on_date
        )
        SELECT rank, total FROM ranked WHERE symbol = '{symbol}'
    """).fetchone()

    rs_rank  = int(rs_row[0]) if rs_row else 0
    rs_total = int(rs_row[1]) if rs_row else 0
    rs_pct   = round((rs_total - rs_rank) / max(rs_total - 1, 1) * 100, 1) if rs_row else 0.0

    # Build insights from computed scalar values
    above_count = sum([above20, above50, above200])

    insights: list[Insight] = []

    # Rank insight
    if rs_rank <= 5 and rs_total > 0:
        insights.append(Insight(
            title=f"Elite Rank #{rs_rank} of {rs_total}",
            body=f"Top {round(100 - rs_pct)}% performer by 1-month return among NIFTY 50",
            category='strength', significance='high',
        ))
    elif rs_rank <= 10 and rs_total > 0:
        insights.append(Insight(
            title="Top 10 Performer",
            body=f"Ranked #{rs_rank} of {rs_total} by 1-month return",
            category='strength', significance='medium',
        ))

    # Regime insight
    if above_count == 3:
        insights.append(Insight(
            title="Full Bull Structure",
            body="Price trading above SMA20, SMA50, and SMA200 simultaneously",
            category='trend', significance='high',
        ))
    elif above_count == 0:
        insights.append(Insight(
            title="Full Bear Structure",
            body="Price trading below all major moving averages",
            category='trend', significance='high',
        ))

    # ATR insight
    if atr_percentile > 85:
        insights.append(Insight(
            title="Elevated Volatility",
            body=f"ATR at {atr_percentile:.0f}th percentile — unusually high daily range",
            category='risk', significance='high',
        ))
    elif atr_percentile < 15:
        insights.append(Insight(
            title="Compressed Volatility",
            body=f"ATR at {atr_percentile:.0f}th percentile — historically calm conditions",
            category='risk', significance='medium',
        ))

    # Drawdown insight
    if current_dd < -20:
        insights.append(Insight(
            title=f"Deep Drawdown: {current_dd:.1f}%",
            body=f"Historical max drawdown: {max_dd:.1f}% from peak",
            category='risk', significance='high',
        ))
    elif abs(current_dd) < 2:
        insights.append(Insight(
            title="Near Peak Price",
            body="Less than 2% from historical high — strong uptrend",
            category='trend', significance='medium',
        ))

    # Return percentile insights
    if ret_1m_pct > 90:
        insights.append(Insight(
            title="Exceptional 1-Month Return",
            body=f"+{cur_ret_1m:.1f}% in 1 month — {ret_1m_pct:.0f}th historical percentile",
            category='momentum', significance='high',
        ))
    if ret_1y_pct > 90:
        insights.append(Insight(
            title="Top Annual Return",
            body=f"+{cur_ret_1y:.1f}% over 1 year — {ret_1y_pct:.0f}th historical percentile",
            category='momentum', significance='high',
        ))
    if ret_1m_pct < 10:
        insights.append(Insight(
            title="Weak 1-Month Return",
            body=f"{cur_ret_1m:.1f}% in 1 month — bottom {100 - ret_1m_pct:.0f}th percentile",
            category='momentum', significance='medium',
        ))

    order = {'high': 0, 'medium': 1, 'low': 2}
    insights.sort(key=lambda x: order[x.significance])
    return InsightsResponse(
        symbol=symbol,
        insights=insights[:10],
        generated_at=datetime.now().strftime('%Y-%m-%d %H:%M'),
    )


@_day_cached
def get_summary(symbol: str) -> StockSummary:
    con = get_connection()
    # Single query: share all_prices CTE between SMA window fns and 52W range subquery
    row = con.execute(f"""
        WITH all_prices AS (
            SELECT
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
                close, volume,
                CAST(date AS DATE) AS dt,
                ROW_NUMBER() OVER (ORDER BY date) AS rn
            FROM equities_prices
            WHERE symbol = '{symbol}'
        ),
        y52w AS (
            SELECT MAX(close) AS high_52w, MIN(close) AS low_52w
            FROM all_prices
            WHERE dt >= (CURRENT_DATE - INTERVAL 1 YEAR)
        ),
        sma AS (
            SELECT a.*,
                CASE WHEN rn >= 20  THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 19  PRECEDING AND CURRENT ROW) END AS sma20,
                CASE WHEN rn >= 50  THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 49  PRECEDING AND CURRENT ROW) END AS sma50,
                CASE WHEN rn >= 200 THEN AVG(close) OVER (ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) END AS sma200,
                AVG(volume) OVER (ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS avg_vol20,
                LAG(close, 1) OVER (ORDER BY date) AS prev_close
            FROM all_prices a
        )
        SELECT s.date, s.close, s.sma20, s.sma50, s.sma200, s.avg_vol20, s.prev_close,
               y.high_52w, y.low_52w
        FROM sma s CROSS JOIN y52w y
        ORDER BY s.date DESC LIMIT 1
    """).fetchone()

    if row is None:
        raise ValueError(f"No data found for symbol: {symbol}")

    # cols: [0]=date [1]=close [2]=sma20 [3]=sma50 [4]=sma200 [5]=avg_vol20
    #       [6]=prev_close [7]=high_52w [8]=low_52w
    close = float(row[1])
    prev  = float(row[6] or close)
    change_pct = round((close - prev) / prev * 100, 2) if prev else 0.0

    above_sma20  = bool(row[2] and close > row[2])
    above_sma50  = bool(row[3] and close > row[3])
    above_sma200 = bool(row[4] and close > row[4])

    bullish_count = sum([above_sma20, above_sma50, above_sma200])
    regime = "Bullish" if bullish_count >= 3 else ("Bearish" if bullish_count == 0 else "Mixed")

    return StockSummary(
        symbol=symbol,
        name=symbol,
        close=round(close, 2),
        change_pct=change_pct,
        high_52w=round(float(row[7] or 0), 2),
        low_52w=round(float(row[8] or 0), 2),
        avg_volume_20d=round(float(row[5] or 0), 0),
        above_sma20=above_sma20,
        above_sma50=above_sma50,
        above_sma200=above_sma200,
        regime=regime,
        date=row[0],
    )


def invalidate_cache() -> int:
    """Clear all day-cached results. Returns number of entries cleared."""
    count = len(_cache)
    _cache.clear()
    return count
