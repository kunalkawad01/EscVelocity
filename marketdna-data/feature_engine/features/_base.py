"""Shared utilities for all feature modules."""
from __future__ import annotations

import logging
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

import numpy as np
import polars as pl

FEATURES_DIR = Path("data_lake/features")

log = logging.getLogger(__name__)


def read_feature(name: str) -> Optional[pl.DataFrame]:
    """Return feature parquet as DataFrame, or None if it does not exist."""
    path = FEATURES_DIR / f"{name}.parquet"
    return pl.read_parquet(path) if path.exists() else None


def get_max_date(name: str) -> Optional[str]:
    """Return max date (ISO YYYY-MM-DD string) from feature parquet, or None."""
    path = FEATURES_DIR / f"{name}.parquet"
    if not path.exists():
        return None
    df = pl.read_parquet(path, columns=["date"])
    if df.is_empty():
        return None
    val = df["date"].max()
    return str(val)[:10] if val is not None else None


def warm_up_where(name: str, buffer_days: int = 375) -> str:
    """DuckDB WHERE fragment for incremental warm-up window.

    Returns '' for cold runs. buffer_days=375 gives ~260 trading days —
    enough warm-up for SMA200 (200 bars) + slope lookbacks (20 bars).
    Example return: "AND CAST(date AS DATE) >= DATE '2025-06-02'"
    """
    max_date_str = get_max_date(name)
    if max_date_str is None:
        return ""
    d = date.fromisoformat(max_date_str)
    start = d - timedelta(days=buffer_days)
    return f"AND CAST(date AS DATE) >= DATE '{start.isoformat()}'"


def filter_new_rows(df: pl.DataFrame, name: str, date_col: str = "date") -> pl.DataFrame:
    """Keep only rows strictly after the current max_date in the feature store."""
    max_date_str = get_max_date(name)
    if max_date_str is None:
        return df
    return df.filter(pl.col(date_col) > max_date_str)


def merge_incremental(name: str, df_new: pl.DataFrame, key_cols: list[str]) -> pl.DataFrame:
    """Concat df_new (already filtered to new rows only) with existing parquet, dedup, sort."""
    existing = read_feature(name)
    if existing is None:
        return df_new
    return (
        pl.concat([existing, df_new])
        .unique(subset=key_cols, keep="last")
        .sort(key_cols)
    )


# ── NumPy indicator helpers ────────────────────────────────────────────────────

def wilder(arr: np.ndarray, period: int) -> np.ndarray:
    """Wilder's smoothing. Seeds with sum of first `period` values at index period-1.

    Returns the raw Wilder sum (not average). Divide by period to get ATR/ADX.
    """
    n = len(arr)
    result = np.full(n, np.nan)
    if n < period:
        return result
    seed_slice = arr[:period]
    if np.any(np.isnan(seed_slice)):
        return result
    result[period - 1] = float(seed_slice.sum())
    for i in range(period, n):
        v = arr[i]
        if not np.isnan(v) and not np.isnan(result[i - 1]):
            result[i] = result[i - 1] - result[i - 1] / period + v
    return result


def ema(arr: np.ndarray, period: int) -> np.ndarray:
    """EMA with SMA seed. NaN for first period-1 values."""
    n = len(arr)
    result = np.full(n, np.nan)
    if n < period:
        return result
    seed = arr[:period]
    if np.any(np.isnan(seed)):
        return result
    result[period - 1] = float(seed.mean())
    k = 2.0 / (period + 1)
    for i in range(period, n):
        v = arr[i]
        if not np.isnan(v):
            result[i] = v * k + result[i - 1] * (1.0 - k)
        else:
            result[i] = result[i - 1]
    return result


def rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    """RSI using Wilder smoothing — matches markov_options_service._compute_rsi exactly."""
    n = len(closes)
    result = np.full(n, 50.0)
    if n <= period:
        return result
    deltas = np.diff(closes)
    gains = np.maximum(deltas, 0.0)
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


def sma(arr: np.ndarray, period: int) -> np.ndarray:
    """Simple moving average. NaN for first period-1 values."""
    n = len(arr)
    result = np.full(n, np.nan)
    for i in range(period - 1, n):
        window = arr[i - period + 1: i + 1]
        if not np.any(np.isnan(window)):
            result[i] = window.mean()
    return result


def rolling_min(arr: np.ndarray, period: int) -> np.ndarray:
    """Rolling minimum."""
    n = len(arr)
    result = np.full(n, np.nan)
    for i in range(period - 1, n):
        result[i] = arr[i - period + 1: i + 1].min()
    return result


def rolling_max(arr: np.ndarray, period: int) -> np.ndarray:
    """Rolling maximum."""
    n = len(arr)
    result = np.full(n, np.nan)
    for i in range(period - 1, n):
        result[i] = arr[i - period + 1: i + 1].max()
    return result
