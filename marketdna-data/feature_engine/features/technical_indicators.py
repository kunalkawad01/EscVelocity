"""RSI, EMA, MACD, Bollinger, Stochastic, ATR, ADX, OBV, Volume for all 500 symbols."""
import logging
import time

import numpy as np
import polars as pl

from feature_engine.features._base import (
    warm_up_where, filter_new_rows, merge_incremental,
    wilder, ema, rsi, sma,
)
from feature_engine.writers.feature_writer import write_feature
from warehouse.register_views import get_connection

log = logging.getLogger(__name__)
NAME = "technical_indicators"

_OUT_COLS = [
    "symbol", "date",
    "rsi_14",
    "ema_20", "ema_50",
    "macd_line", "macd_signal", "macd_hist",
    "bb_upper", "bb_lower", "bb_pct_b", "bb_bandwidth",
    "stoch_k", "stoch_d",
    "atr_14", "atr_pct",
    "adx_14", "plus_di_14", "minus_di_14",
    "volume_sma20", "volume_ratio",
    "obv",
]


def _adx_suite(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    period: int = 14,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return (atr14, adx14, plus_di, minus_di) all in proper units / 0-100."""
    n = len(closes)
    tr = np.zeros(n)
    pdm = np.zeros(n)
    mdm = np.zeros(n)

    for i in range(1, n):
        hl  = highs[i] - lows[i]
        hpc = abs(highs[i] - closes[i - 1])
        lpc = abs(lows[i]  - closes[i - 1])
        tr[i] = max(hl, hpc, lpc)
        up = highs[i] - highs[i - 1]
        dn = lows[i - 1] - lows[i]
        pdm[i] = up if (up > dn and up > 0) else 0.0
        mdm[i] = dn if (dn > up and dn > 0) else 0.0

    atr_sum = wilder(tr,  period)
    pdi_sum = wilder(pdm, period)
    mdi_sum = wilder(mdm, period)

    # pdi/mdi: ratios of Wilder sums — period cancels, result in %
    pdi = 100.0 * pdi_sum / (atr_sum + 1e-9)
    mdi = 100.0 * mdi_sum / (atr_sum + 1e-9)
    dx  = 100.0 * np.abs(pdi - mdi) / (pdi + mdi + 1e-9)

    adx_sum = wilder(dx, period)
    atr14   = atr_sum / period   # Wilder sum -> average
    adx14   = adx_sum / period   # Wilder sum -> average (0-100)

    return atr14, adx14, pdi, mdi


def _compute_sym(sym_df: pl.DataFrame) -> pl.DataFrame:
    """Compute all indicators for one symbol DataFrame."""
    closes  = sym_df["close"].to_numpy()
    highs   = sym_df["high"].to_numpy()
    lows    = sym_df["low"].to_numpy()
    volumes = sym_df["volume"].to_numpy().astype(float)
    bb_mid  = sym_df["bb_mid"].to_numpy()
    bb_std  = sym_df["bb_std"].to_numpy()
    slo14   = sym_df["stoch_low14"].to_numpy()
    shi14   = sym_df["stoch_high14"].to_numpy()
    v_sma20 = sym_df["volume_sma20"].to_numpy()
    n = len(closes)

    # RSI(14)
    rsi14 = rsi(closes, 14)

    # EMA(20), EMA(50)
    ema20 = ema(closes, 20)
    ema50 = ema(closes, 50)

    # MACD(12, 26, 9)
    ema12  = ema(closes, 12)
    ema26  = ema(closes, 26)
    macd_l = ema12 - ema26
    macd_sig = np.full(n, np.nan)
    macd_his = np.full(n, np.nan)
    valid = np.where(~np.isnan(macd_l))[0]
    if len(valid) >= 9:
        s = valid[0]
        sig = ema(macd_l[s:], 9)
        macd_sig[s:] = sig
        macd_his[s:] = macd_l[s:] - sig

    # Bollinger Bands (from DuckDB SMA + STDDEV_POP)
    bb_upper = bb_mid + 2.0 * bb_std
    bb_lower = bb_mid - 2.0 * bb_std
    bb_range = bb_upper - bb_lower
    bb_pct_b = np.where(bb_range > 0, (closes - bb_lower) / bb_range * 100.0, np.nan)
    bb_bw    = np.where(bb_mid > 0, bb_range / bb_mid * 100.0, np.nan)

    # Stochastic(14, 3, 3)
    raw_k   = np.where((shi14 - slo14) > 0, (closes - slo14) / (shi14 - slo14) * 100.0, np.nan)
    stoch_k = sma(raw_k, 3)    # slow %K
    stoch_d = sma(stoch_k, 3)  # %D

    # ATR(14) + ADX(14) + +DI/-DI
    atr14, adx14, pdi, mdi = _adx_suite(highs, lows, closes, 14)

    # Volume ratio
    vol_ratio = np.where(v_sma20 > 0, volumes / v_sma20, np.nan)

    # OBV (vectorised)
    direction = np.concatenate([[1.0], np.sign(np.diff(closes))])
    obv = np.cumsum(volumes * direction).astype(np.int64)

    return sym_df.with_columns([
        pl.Series("rsi_14",       np.round(rsi14,   2)),
        pl.Series("ema_20",       np.round(ema20,   4)),
        pl.Series("ema_50",       np.round(ema50,   4)),
        pl.Series("macd_line",    np.round(macd_l,  4)),
        pl.Series("macd_signal",  np.round(macd_sig, 4)),
        pl.Series("macd_hist",    np.round(macd_his, 4)),
        pl.Series("bb_upper",     np.round(bb_upper, 4)),
        pl.Series("bb_lower",     np.round(bb_lower, 4)),
        pl.Series("bb_pct_b",     np.round(bb_pct_b, 2)),
        pl.Series("bb_bandwidth", np.round(bb_bw,    4)),
        pl.Series("stoch_k",      np.round(stoch_k,  2)),
        pl.Series("stoch_d",      np.round(stoch_d,  2)),
        pl.Series("atr_14",       np.round(atr14,    4)),
        pl.Series("atr_pct",      np.round(atr14 / (closes + 1e-9) * 100.0, 4)),
        pl.Series("adx_14",       np.round(adx14,    2)),
        pl.Series("plus_di_14",   np.round(pdi,      2)),
        pl.Series("minus_di_14",  np.round(mdi,      2)),
        pl.Series("volume_sma20", v_sma20.astype(np.int64)),
        pl.Series("volume_ratio", np.round(vol_ratio, 4)),
        pl.Series("obv",          obv),
    ])


def compute(incremental: bool = False) -> pl.DataFrame:
    """Compute technical_indicators feature. Returns full merged DataFrame."""
    t0 = time.perf_counter()
    where_clause = warm_up_where(NAME) if incremental else ""

    con = get_connection()
    df_raw = con.execute(f"""
        SELECT
            symbol,
            STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
            close, high, low,
            CAST(volume AS BIGINT) AS volume,
            -- Bollinger mid + std (DuckDB STDDEV_POP = population std, matches TradingView)
            AVG(close)       OVER (PARTITION BY symbol ORDER BY date
                ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS bb_mid,
            STDDEV_POP(close) OVER (PARTITION BY symbol ORDER BY date
                ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS bb_std,
            -- Stochastic rolling extremes (14-bar lookback)
            MIN(low)  OVER (PARTITION BY symbol ORDER BY date
                ROWS BETWEEN 13 PRECEDING AND CURRENT ROW) AS stoch_low14,
            MAX(high) OVER (PARTITION BY symbol ORDER BY date
                ROWS BETWEEN 13 PRECEDING AND CURRENT ROW) AS stoch_high14,
            -- Volume SMA(20)
            AVG(CAST(volume AS DOUBLE)) OVER (PARTITION BY symbol ORDER BY date
                ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS volume_sma20,
            ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date) AS rn
        FROM equities_prices
        WHERE 1=1 {where_clause}
        ORDER BY symbol, date
    """).pl()

    # Per-symbol NumPy computation
    results: list[pl.DataFrame] = []
    for sym_df in df_raw.partition_by("symbol", maintain_order=True):
        results.append(_compute_sym(sym_df))

    df = pl.concat(results).select(_OUT_COLS)

    if incremental:
        df = filter_new_rows(df, NAME)
        df = merge_incremental(NAME, df, ["symbol", "date"])

    log.info("%s: %d rows in %.1fs", NAME, len(df), time.perf_counter() - t0)
    return df
