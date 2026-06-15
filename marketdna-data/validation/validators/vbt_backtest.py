"""VectorBT backtest: long top decile / short bottom decile on stock_dna_score.

Strategy:
  - Universe: all symbols with a stock_dna_score on that day
  - Top decile (score >= 90th pct): equal-weight long
  - Bottom decile (score <= 10th pct): equal-weight short
  - Rebalance: monthly (end of each calendar month)
  - Costs: 0.1% one-way (20bps round-trip) — NSE NIFTY mid-cap realistic estimate
  - Period: full history from 2020-01-01

Outputs:
  - total_return_pct
  - annualised_return_pct
  - sharpe_ratio
  - max_drawdown_pct
  - calmar_ratio
  - win_rate (% of months L/S portfolio positive)
  - benchmark_return_pct (equal-weight all 500 symbols)
  - alpha (L/S return - benchmark)
"""
from __future__ import annotations

import logging
from typing import NamedTuple

import duckdb
import numpy as np
import polars as pl

log = logging.getLogger(__name__)

_STOCK_DNA = "data_lake/features/stock_dna.parquet"
_SMA       = "data_lake/features/sma_regime.parquet"


class BacktestResult(NamedTuple):
    strategy: str
    total_return_pct: float
    annualised_return_pct: float
    sharpe_ratio: float
    max_drawdown_pct: float
    calmar_ratio: float
    win_rate: float
    benchmark_return_pct: float
    alpha_pct: float
    n_months: int
    passed: bool


def _pivot_close(score_df: pl.DataFrame, close_df: pl.DataFrame) -> tuple[np.ndarray, list[str], list[str]]:
    """Pivot close prices to (dates × symbols) matrix."""
    close_wide = close_df.pivot(
        index="date", on="symbol", values="close", aggregate_function="mean"
    ).sort("date")

    dates   = close_wide["date"].to_list()
    symbols = [c for c in close_wide.columns if c != "date"]
    prices  = close_wide.select(symbols).to_numpy().astype(float)
    return prices, dates, symbols


def _monthly_rebalance_returns(
    prices: np.ndarray,
    dates: list[str],
    score_df: pl.DataFrame,
    symbols: list[str],
    pct_lo: float = 10.0,
    pct_hi: float = 90.0,
    cost_bps: float = 10.0,  # one-way bps
) -> tuple[list[float], list[float]]:
    """Compute monthly L/S and benchmark returns via manual simulation.

    Returns (ls_monthly_rets, bm_monthly_rets) as lists of floats.
    """
    sym_idx = {s: i for i, s in enumerate(symbols)}

    # Group dates by YYYY-MM
    from collections import defaultdict
    month_map: dict[str, list[int]] = defaultdict(list)
    for i, d in enumerate(dates):
        month_map[d[:7]].append(i)

    sorted_months = sorted(month_map)
    ls_rets: list[float] = []
    bm_rets: list[float] = []

    for m_idx in range(len(sorted_months) - 1):
        cur_month  = sorted_months[m_idx]
        next_month = sorted_months[m_idx + 1]

        cur_last_day  = dates[month_map[cur_month][-1]]
        next_last_day = dates[month_map[next_month][-1]]

        # Scores at end of current month
        scores_at_date = (
            score_df
            .filter(pl.col("date") == cur_last_day)
            .select(["symbol", "stock_dna_score"])
            .drop_nulls()
        )
        if scores_at_date.is_empty():
            continue

        sc_arr  = scores_at_date["stock_dna_score"].to_numpy()
        sym_arr = scores_at_date["symbol"].to_list()

        lo_thr = float(np.percentile(sc_arr, pct_lo))
        hi_thr = float(np.percentile(sc_arr, pct_hi))

        longs  = [s for s, v in zip(sym_arr, sc_arr) if v >= hi_thr]
        shorts = [s for s, v in zip(sym_arr, sc_arr) if v <= lo_thr]

        if not longs or not shorts:
            continue

        # Prices at entry (end of cur_month) and exit (end of next_month)
        cur_idx  = month_map[cur_month][-1]
        next_idx = month_map[next_month][-1]

        def _sym_return(sym: str) -> float | None:
            idx = sym_idx.get(sym)
            if idx is None:
                return None
            p0 = prices[cur_idx, idx]
            p1 = prices[next_idx, idx]
            if np.isnan(p0) or np.isnan(p1) or p0 <= 0:
                return None
            return (p1 - p0) / p0 * 100

        long_rets  = [r for s in longs  if (r := _sym_return(s)) is not None]
        short_rets = [r for s in shorts if (r := _sym_return(s)) is not None]

        if not long_rets or not short_rets:
            continue

        long_mean  = float(np.mean(long_rets))
        short_mean = float(np.mean(short_rets))
        cost = cost_bps / 100  # % one-way per leg
        ls_ret = long_mean - short_mean - 2 * cost  # 2 legs, each rebalanced
        ls_rets.append(ls_ret)

        # Benchmark: equal-weight all symbols with scores
        all_syms = sym_arr
        bm_r = [r for s in all_syms if (r := _sym_return(s)) is not None]
        bm_rets.append(float(np.mean(bm_r)) if bm_r else 0.0)

    return ls_rets, bm_rets


def _perf_stats(monthly_rets: list[float]) -> dict[str, float]:
    arr = np.array(monthly_rets) / 100  # -> decimal
    if len(arr) < 3:
        return {"total": 0, "ann": 0, "sharpe": 0, "mdd": 0, "calmar": 0, "win": 0}
    cum = np.cumprod(1 + arr)
    total = float((cum[-1] - 1) * 100)
    n_years = len(arr) / 12
    ann = float(((cum[-1]) ** (1 / n_years) - 1) * 100) if n_years > 0 else 0
    sharpe = float(arr.mean() / (arr.std() + 1e-9) * np.sqrt(12))
    rolling_max = np.maximum.accumulate(cum)
    drawdowns = (cum - rolling_max) / (rolling_max + 1e-9) * 100
    mdd = float(drawdowns.min())
    calmar = ann / abs(mdd) if mdd < 0 else 0
    win = float((arr > 0).mean())
    return {"total": total, "ann": ann, "sharpe": sharpe, "mdd": mdd, "calmar": calmar, "win": win}


def run() -> BacktestResult:
    """Run L/S stock_dna_score backtest using manual simulation."""
    import vectorbt as vbt  # confirm available
    log.info("  vbt_backtest: loading data...")

    score_df = pl.read_parquet(_STOCK_DNA)
    close_df = pl.read_parquet(_SMA).select(["symbol", "date", "close"])

    prices, dates, symbols = _pivot_close(score_df, close_df)
    log.info("  vbt_backtest: %d dates x %d symbols", len(dates), len(symbols))

    ls_rets, bm_rets = _monthly_rebalance_returns(prices, dates, score_df, symbols)

    if len(ls_rets) < 3:
        log.warning("  vbt_backtest: insufficient monthly returns (%d)", len(ls_rets))
        return BacktestResult("L/S stock_dna_score", 0, 0, 0, 0, 0, 0, 0, 0, 0, False)

    ls_stats = _perf_stats(ls_rets)
    bm_stats = _perf_stats(bm_rets)
    alpha    = ls_stats["total"] - bm_stats["total"]

    result = BacktestResult(
        strategy="L/S top-10%% vs bottom-10%% stock_dna_score (monthly rebal, 20bps RT cost)",
        total_return_pct=round(ls_stats["total"], 2),
        annualised_return_pct=round(ls_stats["ann"], 2),
        sharpe_ratio=round(ls_stats["sharpe"], 3),
        max_drawdown_pct=round(ls_stats["mdd"], 2),
        calmar_ratio=round(ls_stats["calmar"], 3),
        win_rate=round(ls_stats["win"], 4),
        benchmark_return_pct=round(bm_stats["total"], 2),
        alpha_pct=round(alpha, 2),
        n_months=len(ls_rets),
        passed=ls_stats["sharpe"] > 0.3,
    )

    log.info(
        "  vbt_backtest: total=%.1f%%  ann=%.1f%%  sharpe=%.2f  mdd=%.1f%%  "
        "calmar=%.2f  win=%.0f%%  alpha=%.1f%%",
        result.total_return_pct, result.annualised_return_pct,
        result.sharpe_ratio, result.max_drawdown_pct,
        result.calmar_ratio, result.win_rate * 100,
        result.alpha_pct,
    )
    return result
