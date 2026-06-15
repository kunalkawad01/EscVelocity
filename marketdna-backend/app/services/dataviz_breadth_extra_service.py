"""Multi-SMA breadth, Advance-Decline, Correlation Matrix, Alpha-Beta services."""
import logging
import time
from datetime import date

import numpy as np
import polars as pl
from scipy import stats as sp_stats

from app.services.duckdb_client import get_connection
from app.models.dataviz_breadth_extra import (
    ADPoint, ADResponse,
    AlphaBetaPoint, AlphaBetaResponse,
    CorrMatrixResponse,
    MultiSMAPoint, MultiSMAResponse,
)

log = logging.getLogger(__name__)

_multisma_cache:   dict[str, MultiSMAResponse]   = {}
_ad_cache:         dict[str, ADResponse]          = {}
_corrmatrix_cache: dict[str, CorrMatrixResponse] = {}
_alphabeta_cache:  dict[str, AlphaBetaResponse]  = {}


def get_multi_sma() -> MultiSMAResponse:
    cache_key = f"multisma:{date.today()}"
    if cache_key in _multisma_cache:
        return _multisma_cache[cache_key]

    t0 = time.perf_counter()
    con = get_connection()
    df = con.execute("""
        WITH daily_sma AS (
            SELECT
                CAST(date AS DATE) AS dt,
                DATE_TRUNC('week', CAST(date AS DATE)) AS week_start,
                symbol, close,
                AVG(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN  19 PRECEDING AND CURRENT ROW) AS sma20,
                AVG(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN  49 PRECEDING AND CURRENT ROW) AS sma50,
                AVG(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS sma200,
                COUNT(*)   OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS bar_count
            FROM equities_prices
        ),
        daily_flags AS (
            SELECT dt, week_start, symbol,
                CASE WHEN bar_count >=  20 AND close > sma20  THEN 1 ELSE 0 END AS above20,
                CASE WHEN bar_count >=  50 AND close > sma50  THEN 1 ELSE 0 END AS above50,
                CASE WHEN bar_count >= 200 AND close > sma200 THEN 1 ELSE 0 END AS above200
            FROM daily_sma
        ),
        week_last AS (
            SELECT week_start, MAX(dt) AS last_dt FROM daily_flags GROUP BY week_start
        ),
        weekly AS (
            SELECT l.last_dt AS week_date,
                COUNT(DISTINCT f.symbol) AS total,
                SUM(f.above20)  AS n20,
                SUM(f.above50)  AS n50,
                SUM(f.above200) AS n200
            FROM daily_flags f
            JOIN week_last l ON f.week_start = l.week_start AND f.dt = l.last_dt
            GROUP BY l.last_dt
        )
        SELECT
            STRFTIME('%Y-%m-%d', week_date)        AS week_date,
            CAST(total AS INTEGER)                  AS total_symbols,
            ROUND(100.0 * n20  / total, 1)          AS pct_above_20,
            ROUND(100.0 * n50  / total, 1)          AS pct_above_50,
            ROUND(100.0 * n200 / total, 1)          AS pct_above_200
        FROM weekly
        ORDER BY week_date
    """).pl()

    as_of = df["week_date"].max() if not df.is_empty() else str(date.today())
    result = MultiSMAResponse(
        as_of=as_of,
        data=[MultiSMAPoint(**r) for r in df.to_dicts()],
        computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
    )
    log.info("multisma: weeks=%d in %.2fs", len(df), time.perf_counter() - t0)
    _multisma_cache[cache_key] = result
    return result


def get_advance_decline() -> ADResponse:
    cache_key = f"adline:{date.today()}"
    if cache_key in _ad_cache:
        return _ad_cache[cache_key]

    t0 = time.perf_counter()
    con = get_connection()
    df = con.execute("""
        WITH daily_moves AS (
            SELECT
                CAST(date AS DATE) AS dt,
                DATE_TRUNC('week', CAST(date AS DATE)) AS week_start,
                symbol, close,
                LAG(close) OVER (PARTITION BY symbol ORDER BY date) AS prev_close
            FROM equities_prices
        ),
        daily_ad AS (
            SELECT dt, week_start, symbol,
                CASE WHEN close > prev_close THEN 1 ELSE 0 END AS is_adv,
                CASE WHEN close < prev_close THEN 1 ELSE 0 END AS is_dec
            FROM daily_moves
            WHERE prev_close IS NOT NULL
        ),
        week_last AS (
            SELECT week_start, MAX(dt) AS last_dt FROM daily_ad GROUP BY week_start
        ),
        weekly AS (
            SELECT l.last_dt AS week_date,
                CAST(SUM(f.is_adv) AS INTEGER) AS advancers,
                CAST(SUM(f.is_dec) AS INTEGER) AS decliners,
                CAST(SUM(f.is_adv) - SUM(f.is_dec) AS INTEGER) AS net
            FROM daily_ad f
            JOIN week_last l ON f.week_start = l.week_start AND f.dt = l.last_dt
            GROUP BY l.last_dt
        )
        SELECT
            STRFTIME('%Y-%m-%d', week_date) AS week_date,
            advancers,
            decliners,
            net,
            CAST(SUM(net) OVER (ORDER BY week_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS INTEGER) AS cumulative
        FROM weekly
        ORDER BY week_date
    """).pl()

    as_of = df["week_date"].max() if not df.is_empty() else str(date.today())
    result = ADResponse(
        as_of=as_of,
        data=[ADPoint(**r) for r in df.to_dicts()],
        computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
    )
    log.info("adline: weeks=%d in %.2fs", len(df), time.perf_counter() - t0)
    _ad_cache[cache_key] = result
    return result


VALID_CORR_HORIZONS = {"ret_1d", "ret_5d", "ret_20d"}


def get_correlation_matrix(horizon: str = "ret_1d", lookback: int = 252) -> CorrMatrixResponse:
    if horizon not in VALID_CORR_HORIZONS:
        horizon = "ret_1d"
    if lookback not in {63, 126, 252}:
        lookback = 252
    cache_key = f"corrmatrix:{date.today()}:{horizon}:{lookback}"
    if cache_key in _corrmatrix_cache:
        return _corrmatrix_cache[cache_key]

    t0 = time.perf_counter()
    con = get_connection()

    df = con.execute(f"""
        SELECT
            STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS dt,
            symbol,
            {horizon} AS ret
        FROM returns_features
        WHERE {horizon} IS NOT NULL
          AND CAST(date AS DATE) >= (
                SELECT MAX(CAST(date AS DATE)) - INTERVAL {lookback + 15} DAYS
                FROM returns_features
              )
        ORDER BY dt, symbol
    """).pl()

    as_of = df["dt"].max() if not df.is_empty() else str(date.today())

    # Pivot to wide format: rows = dates, columns = symbols
    wide = df.pivot(index="dt", on="symbol", values="ret")
    symbols = [c for c in wide.columns if c != "dt"]

    # Drop any rows with nulls, take last `lookback` rows
    mat = wide.select(symbols).drop_nulls().to_numpy()
    mat = mat[-lookback:, :]

    if mat.shape[0] < 30 or mat.shape[1] < 2:
        return CorrMatrixResponse(
            as_of=as_of, symbols=symbols, matrix=[],
            computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
        )

    corr = np.corrcoef(mat.T)
    corr_rounded = [[round(float(v), 3) for v in row] for row in corr]

    result = CorrMatrixResponse(
        as_of=as_of,
        symbols=symbols,
        matrix=corr_rounded,
        computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
    )
    log.info("corrmatrix: symbols=%d lookback=%d in %.2fs", len(symbols), lookback, time.perf_counter() - t0)
    _corrmatrix_cache[cache_key] = result
    return result


VALID_AB_HORIZONS = {"ret_1d", "ret_5d", "ret_20d"}
_PERIODS_PER_YEAR = {"ret_1d": 252, "ret_5d": 52, "ret_20d": 12}


def get_alpha_beta(horizon: str = "ret_1d", lookback: int = 252) -> AlphaBetaResponse:
    if horizon not in VALID_AB_HORIZONS:
        horizon = "ret_1d"
    if lookback not in {63, 126, 252}:
        lookback = 252
    cache_key = f"alphabeta:{date.today()}:{horizon}:{lookback}"
    if cache_key in _alphabeta_cache:
        return _alphabeta_cache[cache_key]

    t0 = time.perf_counter()
    con = get_connection()

    df = con.execute(f"""
        SELECT
            STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS dt,
            symbol,
            {horizon} AS ret
        FROM returns_features
        WHERE {horizon} IS NOT NULL
          AND CAST(date AS DATE) >= (
                SELECT MAX(CAST(date AS DATE)) - INTERVAL {lookback + 15} DAYS
                FROM returns_features
              )
        ORDER BY dt
    """).pl()

    as_of = df["dt"].max() if not df.is_empty() else str(date.today())

    # Equal-weight proxy return per day
    proxy = df.group_by("dt").agg(pl.col("ret").mean().alias("proxy"))
    merged = df.join(proxy, on="dt", how="inner").drop_nulls()

    periods_per_year = _PERIODS_PER_YEAR.get(horizon, 252)
    points: list[AlphaBetaPoint] = []

    for sym in merged["symbol"].unique().to_list():
        grp = merged.filter(pl.col("symbol") == sym)
        x = grp["proxy"].to_numpy()
        y = grp["ret"].to_numpy()
        mask = ~(np.isnan(x) | np.isnan(y))
        if mask.sum() < 30:
            continue
        slope, intercept, r_val, _, _ = sp_stats.linregress(x[mask], y[mask])
        points.append(AlphaBetaPoint(
            symbol=sym,
            alpha=round(float(intercept) * periods_per_year * 100, 2),
            beta=round(float(slope), 3),
            r_squared=round(float(r_val ** 2), 3),
        ))

    points.sort(key=lambda p: p.alpha, reverse=True)

    result = AlphaBetaResponse(
        as_of=as_of,
        horizon=horizon,
        lookback=lookback,
        points=points,
        computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
    )
    log.info("alphabeta: horizon=%s lookback=%d symbols=%d in %.2fs",
             horizon, lookback, len(points), time.perf_counter() - t0)
    _alphabeta_cache[cache_key] = result
    return result
