"""Returns data service for DataViz page. Caches snapshots once per day per horizon."""
import concurrent.futures
import logging
import time
from datetime import date
from pathlib import Path

import polars as pl

from app.config import settings
from app.services.duckdb_client import get_connection
from app.models.dataviz import (
    Above200WeeklyPoint,
    Above200WeeklyResponse,
    ReturnBar,
    ReturnHistoryPoint,
    ReturnHistoryResponse,
    ReturnSnapshotResponse,
    ReturnSnapshotStats,
    ScatterPoint,
    ScatterResponse,
    ScatterStats,
)

_RET_PATH = str(settings.data_path / "data_lake/features/returns.parquet")
_STD_PATH = str(settings.data_path / "data_lake/features/std_deviation.parquet")

log = logging.getLogger(__name__)

# Valid column names — used as SQL identifiers, must be in allowlist to prevent injection
VALID_HORIZONS = frozenset({
    "ret_1d", "ret_2d", "ret_5d", "ret_10d", "ret_20d", "ret_50d",
    "ret_1y", "ret_2y", "ret_3y", "ret_4y", "ret_5y",
    "cagr_1y", "cagr_2y", "cagr_3y", "cagr_4y", "cagr_5y",
})

_snapshot_cache: dict[str, ReturnSnapshotResponse] = {}


def get_snapshot(horizon: str = "ret_1d", top_n: int = 30) -> ReturnSnapshotResponse:
    if horizon not in VALID_HORIZONS:
        horizon = "ret_1d"
    cache_key = f"{date.today()}:{horizon}:{top_n}"
    if cache_key in _snapshot_cache:
        return _snapshot_cache[cache_key]

    t0 = time.perf_counter()
    con = get_connection()

    as_of = con.execute(
        "SELECT STRFTIME('%Y-%m-%d', CAST(MAX(date) AS DATE)) FROM returns_features"
    ).fetchone()[0]

    df = con.execute(f"""
        SELECT symbol, {horizon} AS value
        FROM returns_features
        WHERE STRFTIME('%Y-%m-%d', CAST(date AS DATE)) = ?
          AND {horizon} IS NOT NULL
        ORDER BY {horizon} DESC
    """, [as_of]).pl()

    if df.is_empty():
        raise ValueError(f"No data for horizon={horizon} on {as_of}")

    n_positive = int((df["value"] > 0).sum())
    n_negative = int((df["value"] < 0).sum())

    winners = [
        ReturnBar(symbol=r["symbol"], value=round(r["value"], 4))
        for r in df.head(top_n).to_dicts()
    ]
    losers = [
        ReturnBar(symbol=r["symbol"], value=round(r["value"], 4))
        for r in df.tail(top_n).sort("value").to_dicts()
    ]

    result = ReturnSnapshotResponse(
        horizon=horizon,
        as_of=as_of,
        winners=winners,
        losers=losers,
        stats=ReturnSnapshotStats(
            n_symbols=len(df),
            n_positive=n_positive,
            n_negative=n_negative,
            avg=round(float(df["value"].mean()), 4),
            median=round(float(df["value"].median()), 4),
            max_val=round(float(df["value"].max()), 4),
            min_val=round(float(df["value"].min()), 4),
        ),
        computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
    )
    log.info("dataviz snapshot: horizon=%s top_n=%d as_of=%s rows=%d in %.1fs",
             horizon, top_n, as_of, len(df), time.perf_counter() - t0)
    _snapshot_cache[cache_key] = result
    return result


# Scatter horizon map: label → (ret_col, std_col)
SCATTER_HORIZONS: dict[str, tuple[str, str]] = {
    "1w":  ("ret_5d",  "std_5d"),
    "1m":  ("ret_20d", "std_20d"),
    "3m":  ("ret_50d", "std_50d"),
    "1y":  ("ret_1y",  "std_1y"),
    "3y":  ("ret_3y",  "std_3y"),
}

_scatter_cache: dict[str, ScatterResponse] = {}


def get_scatter(horizon: str = "1m") -> ScatterResponse:
    if horizon not in SCATTER_HORIZONS:
        horizon = "1m"
    cache_key = f"{date.today()}:{horizon}"
    if cache_key in _scatter_cache:
        return _scatter_cache[cache_key]

    ret_col, std_col = SCATTER_HORIZONS[horizon]
    t0 = time.perf_counter()

    # Determine latest shared date from DuckDB (fast, metadata only)
    con = get_connection()
    as_of = con.execute(
        "SELECT STRFTIME('%Y-%m-%d', CAST(MAX(date) AS DATE)) FROM returns_features"
    ).fetchone()[0]

    # Parallel lazy scan of both parquets — Polars pushes date predicate into
    # each file's row-group metadata before reading any column data.
    def _scan_ret() -> pl.DataFrame:
        return (
            pl.scan_parquet(_RET_PATH)
            .filter(pl.col("date") == as_of)
            .select(["symbol", ret_col])
            .collect()
        )

    def _scan_std() -> pl.DataFrame:
        return (
            pl.scan_parquet(_STD_PATH)
            .filter(pl.col("date") == as_of)
            .select(["symbol", std_col])
            .collect()
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        fut_ret = pool.submit(_scan_ret)
        fut_std = pool.submit(_scan_std)
        ret_df = fut_ret.result()
        std_df = fut_std.result()

    joined = (
        ret_df.join(std_df, on="symbol", how="inner")
        .rename({ret_col: "ret", std_col: "std"})
        .drop_nulls()
    )

    median_ret = float(joined["ret"].median())
    median_std = float(joined["std"].median())

    n_hrlv = int(((joined["ret"] >= median_ret) & (joined["std"] < median_std)).sum())
    n_hrhv = int(((joined["ret"] >= median_ret) & (joined["std"] >= median_std)).sum())
    n_lrlv = int(((joined["ret"] < median_ret) & (joined["std"] < median_std)).sum())
    n_lrhv = int(((joined["ret"] < median_ret) & (joined["std"] >= median_std)).sum())

    points = [
        ScatterPoint(symbol=r["symbol"], ret=round(r["ret"], 4), std=round(r["std"], 4))
        for r in joined.to_dicts()
    ]

    result = ScatterResponse(
        horizon=horizon,
        ret_col=ret_col,
        std_col=std_col,
        as_of=as_of,
        points=points,
        stats=ScatterStats(
            n_symbols=len(joined),
            median_ret=round(median_ret, 4),
            median_std=round(median_std, 4),
            n_high_ret_low_vol=n_hrlv,
            n_high_ret_high_vol=n_hrhv,
            n_low_ret_low_vol=n_lrlv,
            n_low_ret_high_vol=n_lrhv,
        ),
        computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
    )
    log.info("dataviz scatter: horizon=%s as_of=%s points=%d in %.2fs",
             horizon, as_of, len(points), time.perf_counter() - t0)
    _scatter_cache[cache_key] = result
    return result


_above200_cache: dict[str, Above200WeeklyResponse] = {}


def get_above200_weekly() -> Above200WeeklyResponse:
    cache_key = f"above200_weekly:{date.today()}"
    if cache_key in _above200_cache:
        return _above200_cache[cache_key]

    t0 = time.perf_counter()
    con = get_connection()

    df = con.execute("""
        WITH daily_sma AS (
            SELECT
                CAST(date AS DATE) AS dt,
                symbol,
                close,
                AVG(close) OVER (
                    PARTITION BY symbol
                    ORDER BY date
                    ROWS BETWEEN 199 PRECEDING AND CURRENT ROW
                ) AS sma200,
                COUNT(*) OVER (
                    PARTITION BY symbol
                    ORDER BY date
                    ROWS BETWEEN 199 PRECEDING AND CURRENT ROW
                ) AS bar_count
            FROM equities_prices
        ),
        daily_above AS (
            SELECT
                dt,
                DATE_TRUNC('week', dt) AS week_start,
                symbol,
                CASE WHEN bar_count >= 200 AND close > sma200 THEN 1 ELSE 0 END AS is_above
            FROM daily_sma
        ),
        week_last_day AS (
            SELECT week_start, MAX(dt) AS last_dt
            FROM daily_above
            GROUP BY week_start
        ),
        weekly_breadth AS (
            SELECT
                l.last_dt AS week_date,
                COUNT(DISTINCT a.symbol) AS total_symbols,
                SUM(a.is_above) AS n_above_200
            FROM daily_above a
            JOIN week_last_day l
              ON a.week_start = l.week_start AND a.dt = l.last_dt
            GROUP BY l.last_dt
        )
        SELECT
            STRFTIME('%Y-%m-%d', week_date) AS week_date,
            CAST(total_symbols AS INTEGER) AS total_symbols,
            CAST(n_above_200 AS INTEGER) AS n_above_200,
            ROUND(100.0 * n_above_200 / total_symbols, 1) AS pct_above_200
        FROM weekly_breadth
        WHERE total_symbols > 0
        ORDER BY week_date
    """).pl()

    as_of = df["week_date"].max() if not df.is_empty() else str(date.today())
    n_symbols = int(df["total_symbols"].max()) if not df.is_empty() else 0

    result = Above200WeeklyResponse(
        as_of=as_of,
        n_symbols=n_symbols,
        data=[
            Above200WeeklyPoint(
                week_date=r["week_date"],
                n_above_200=r["n_above_200"],
                total_symbols=r["total_symbols"],
                pct_above_200=r["pct_above_200"],
            )
            for r in df.to_dicts()
        ],
        computed_at=time.strftime("%Y-%m-%d %H:%M:%S"),
    )
    log.info("dataviz above200_weekly: weeks=%d n_symbols=%d in %.2fs",
             len(df), n_symbols, time.perf_counter() - t0)
    _above200_cache[cache_key] = result
    return result


def get_history(symbol: str, metric: str = "ret_1d") -> ReturnHistoryResponse:
    if metric not in VALID_HORIZONS:
        metric = "ret_1d"
    symbol = symbol.upper()

    con = get_connection()
    df = con.execute(f"""
        SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date, {metric} AS value
        FROM returns_features
        WHERE symbol = ?
          AND {metric} IS NOT NULL
        ORDER BY date
    """, [symbol]).pl()

    return ReturnHistoryResponse(
        symbol=symbol,
        metric=metric,
        data=[
            ReturnHistoryPoint(date=r["date"], value=round(r["value"], 4))
            for r in df.to_dicts()
        ],
    )
