"""Analytics service: histogram, vol term structure, cross-vol, risk-adj ranking, calendar heatmap."""
import concurrent.futures
import logging
import time
from datetime import date

import numpy as np
import polars as pl
from scipy import stats as sp_stats

from app.config import settings
from app.services.duckdb_client import get_connection
from app.models.dataviz_analytics import (
    CalendarPoint, CalendarResponse,
    CrossVolPoint, CrossVolResponse,
    HistogramBucket, HistogramResponse, HistogramStats,
    RiskAdjPoint, RiskAdjResponse,
    VolTermPoint, VolTermStructureResponse,
)

_RET_PATH = str(settings.data_path / "data_lake/features/returns.parquet")
_STD_PATH = str(settings.data_path / "data_lake/features/std_deviation.parquet")

log = logging.getLogger(__name__)

VALID_HORIZONS = frozenset({
    "ret_1d", "ret_5d", "ret_20d", "ret_50d", "ret_1y", "ret_2y", "ret_3y",
    "cagr_1y", "cagr_2y", "cagr_3y", "cagr_5y",
})

SCATTER_HORIZONS: dict[str, tuple[str, str]] = {
    "1w": ("ret_5d",  "std_5d"),
    "1m": ("ret_20d", "std_20d"),
    "3m": ("ret_50d", "std_50d"),
    "1y": ("ret_1y",  "std_1y"),
    "3y": ("ret_3y",  "std_3y"),
}

_histogram_cache: dict[str, HistogramResponse] = {}
_crossvol_cache: dict[str, CrossVolResponse] = {}
_riskadjcache:   dict[str, RiskAdjResponse]   = {}
_calendar_cache: dict[str, CalendarResponse]  = {}
_termstruct_cache: dict[str, VolTermStructureResponse] = {}


def get_histogram(horizon: str = "ret_1d") -> HistogramResponse:
    if horizon not in VALID_HORIZONS:
        horizon = "ret_1d"
    cache_key = f"histogram:{date.today()}:{horizon}"
    if cache_key in _histogram_cache:
        return _histogram_cache[cache_key]

    t0 = time.perf_counter()
    con = get_connection()
    as_of = con.execute(
        "SELECT STRFTIME('%Y-%m-%d', CAST(MAX(date) AS DATE)) FROM returns_features"
    ).fetchone()[0]

    df = con.execute(f"""
        SELECT {horizon} AS ret
        FROM returns_features
        WHERE STRFTIME('%Y-%m-%d', CAST(date AS DATE)) = ?
          AND {horizon} IS NOT NULL
    """, [as_of]).pl()

    vals = df["ret"].to_numpy()
    counts, edges = np.histogram(vals, bins=40)
    centers = ((edges[:-1] + edges[1:]) / 2).round(4)

    result = HistogramResponse(
        horizon=horizon,
        as_of=as_of,
        buckets=[HistogramBucket(center=float(c), count=int(n)) for c, n in zip(centers, counts)],
        stats=HistogramStats(
            mean=round(float(vals.mean()), 4),
            median=round(float(np.median(vals)), 4),
            std=round(float(vals.std()), 4),
            skew=round(float(sp_stats.skew(vals)), 3),
            min_val=round(float(vals.min()), 4),
            max_val=round(float(vals.max()), 4),
        ),
        computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
    )
    log.info("histogram: horizon=%s as_of=%s in %.2fs", horizon, as_of, time.perf_counter() - t0)
    _histogram_cache[cache_key] = result
    return result


VOL_TERM_COLS: list[tuple[str, int, str]] = [
    ("5d",  5,   "std_5d"),
    ("10d", 10,  "std_10d"),
    ("20d", 20,  "std_20d"),
    ("50d", 50,  "std_50d"),
    ("1Y",  252, "std_1y"),
    ("2Y",  504, "std_2y"),
    ("3Y",  756, "std_3y"),
]


def get_vol_term_structure(symbol: str) -> VolTermStructureResponse:
    symbol = symbol.upper()
    cache_key = f"termstruct:{date.today()}:{symbol}"
    if cache_key in _termstruct_cache:
        return _termstruct_cache[cache_key]

    t0 = time.perf_counter()
    con = get_connection()
    as_of = con.execute(
        "SELECT STRFTIME('%Y-%m-%d', CAST(MAX(date) AS DATE)) FROM std_deviation_features"
    ).fetchone()[0]

    col_list = ", ".join(c for _, _, c in VOL_TERM_COLS)
    row = con.execute(f"""
        SELECT {col_list}
        FROM std_deviation_features
        WHERE symbol = ? AND STRFTIME('%Y-%m-%d', CAST(date AS DATE)) = ?
    """, [symbol, as_of]).fetchone()

    vals = row if row is not None else [None] * len(VOL_TERM_COLS)
    points = [
        VolTermPoint(label=label, days=days, std_pct=round(float(val) * 100, 3))
        for (label, days, _), val in zip(VOL_TERM_COLS, vals)
        if val is not None
    ]

    result = VolTermStructureResponse(
        symbol=symbol, as_of=as_of, points=points,
        computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
    )
    log.info("termstruct: symbol=%s as_of=%s in %.2fs", symbol, as_of, time.perf_counter() - t0)
    _termstruct_cache[cache_key] = result
    return result


def get_cross_vol() -> CrossVolResponse:
    cache_key = f"crossvol:{date.today()}"
    if cache_key in _crossvol_cache:
        return _crossvol_cache[cache_key]

    t0 = time.perf_counter()
    con = get_connection()
    df = con.execute("""
        WITH daily AS (
            SELECT
                CAST(date AS DATE) AS dt,
                DATE_TRUNC('week', CAST(date AS DATE)) AS week_start,
                STDDEV(ret_1d)  AS cross_vol,
                AVG(ret_1d)     AS cross_mean
            FROM returns_features
            WHERE ret_1d IS NOT NULL
            GROUP BY CAST(date AS DATE)
        ),
        week_last AS (
            SELECT week_start, MAX(dt) AS last_dt FROM daily GROUP BY week_start
        )
        SELECT
            STRFTIME('%Y-%m-%d', d.dt)         AS week_date,
            ROUND(d.cross_vol  * 100, 3)        AS cross_vol_pct,
            ROUND(d.cross_mean * 100, 3)        AS cross_mean_pct
        FROM daily d
        JOIN week_last w ON d.week_start = w.week_start AND d.dt = w.last_dt
        ORDER BY week_date
    """).pl()

    as_of = df["week_date"].max() if not df.is_empty() else str(date.today())
    result = CrossVolResponse(
        as_of=as_of,
        data=[CrossVolPoint(**r) for r in df.to_dicts()],
        computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
    )
    log.info("crossvol: weeks=%d in %.2fs", len(df), time.perf_counter() - t0)
    _crossvol_cache[cache_key] = result
    return result


def get_risk_adj_ranking(horizon: str = "1m") -> RiskAdjResponse:
    if horizon not in SCATTER_HORIZONS:
        horizon = "1m"
    cache_key = f"riskadjrank:{date.today()}:{horizon}"
    if cache_key in _riskadjcache:
        return _riskadjcache[cache_key]

    ret_col, std_col = SCATTER_HORIZONS[horizon]
    t0 = time.perf_counter()
    con = get_connection()
    as_of = con.execute(
        "SELECT STRFTIME('%Y-%m-%d', CAST(MAX(date) AS DATE)) FROM returns_features"
    ).fetchone()[0]

    def _scan_ret() -> pl.DataFrame:
        return pl.scan_parquet(_RET_PATH).filter(pl.col("date") == as_of).select(["symbol", ret_col]).collect()

    def _scan_std() -> pl.DataFrame:
        return pl.scan_parquet(_STD_PATH).filter(pl.col("date") == as_of).select(["symbol", std_col]).collect()

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        ret_df = pool.submit(_scan_ret).result()
        std_df = pool.submit(_scan_std).result()

    joined = (
        ret_df.join(std_df, on="symbol", how="inner")
        .rename({ret_col: "ret", std_col: "std"})
        .drop_nulls()
        .filter(pl.col("std") > 0)
        .with_columns((pl.col("ret") / pl.col("std")).alias("score"))
        .sort("score", descending=True)
    )

    result = RiskAdjResponse(
        horizon=horizon,
        as_of=as_of,
        data=[
            RiskAdjPoint(
                rank=i + 1,
                symbol=r["symbol"],
                ret=round(r["ret"], 4),
                std=round(r["std"], 4),
                score=round(r["score"], 3),
            )
            for i, r in enumerate(joined.to_dicts())
        ],
        computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
    )
    log.info("riskadjrank: horizon=%s as_of=%s rows=%d in %.2fs", horizon, as_of, len(joined), time.perf_counter() - t0)
    _riskadjcache[cache_key] = result
    return result


def get_calendar(symbol: str, year: int) -> CalendarResponse:
    symbol = symbol.upper()
    cache_key = f"calendar:{date.today()}:{symbol}:{year}"
    if cache_key in _calendar_cache:
        return _calendar_cache[cache_key]

    t0 = time.perf_counter()
    con = get_connection()
    df = con.execute("""
        WITH raw AS (
            SELECT
                CAST(date AS DATE) AS dt,
                close,
                LAG(close) OVER (PARTITION BY symbol ORDER BY date) AS prev_close
            FROM equities_prices
            WHERE symbol = ?
              AND CAST(date AS DATE) >= CAST(? || '-01-01' AS DATE) - INTERVAL 10 DAYS
              AND CAST(date AS DATE) <= CAST(? || '-12-31' AS DATE)
        )
        SELECT
            STRFTIME('%Y-%m-%d', dt) AS date,
            ROUND((close / prev_close - 1.0) * 100, 3) AS ret_pct
        FROM raw
        WHERE prev_close IS NOT NULL
          AND STRFTIME('%Y', dt) = ?
        ORDER BY date
    """, [symbol, str(year), str(year), str(year)]).pl()

    result = CalendarResponse(
        symbol=symbol,
        year=year,
        data=[CalendarPoint(**r) for r in df.to_dicts()],
        computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
    )
    log.info("calendar: symbol=%s year=%d rows=%d in %.2fs", symbol, year, len(df), time.perf_counter() - t0)
    _calendar_cache[cache_key] = result
    return result
