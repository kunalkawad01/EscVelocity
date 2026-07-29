"""Research Copilot — Phase 4: robustness surface.

optimize      — parameter-grid sweep over a strategy template.
walk_forward  — rolling in-sample optimize → out-of-sample test (anti-overfit).
monte_carlo   — resample/shuffle a backtest's trades to a distribution of outcomes.

All deterministic (seed 42), cached by (tool, input, data_version). Builds on
research_backtest. No FastAPI imports.
"""
from __future__ import annotations

import itertools
import math
from typing import Any, Optional

import numpy as np

from app.services import research_backtest as rb
from app.services.research_tools import (
    _load_symbol, data_version, _cache, _cache_key, _hash_result,
)

TRADING_DAYS = 252
MAX_COMBOS = 60
SEED = 42


# ── template substitution ─────────────────────────────────────────────────────

def _substitute(obj: Any, params: dict[str, Any]) -> Any:
    """Replace $name placeholders. A pure '$name' becomes the typed value;
    an embedded 'ema_$fast' becomes a string ('ema_20')."""
    if isinstance(obj, dict):
        return {k: _substitute(v, params) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_substitute(v, params) for v in obj]
    if isinstance(obj, str):
        if obj.startswith("$") and obj[1:] in params:
            return params[obj[1:]]  # pure placeholder → typed value
        out = obj
        for k, v in params.items():
            out = out.replace(f"${k}", str(v))
        return out
    return obj


def _objective_value(portfolio: dict[str, Any], objective: str) -> float:
    if objective == "cagr":
        return portfolio.get("cagr_pct", 0.0)
    if objective == "calmar":
        dd = abs(portfolio.get("max_drawdown_pct", 0.0))
        return portfolio.get("cagr_pct", 0.0) / dd if dd > 0 else 0.0
    return portfolio.get("sharpe", 0.0)  # default


def _run_strategy(strategy: dict[str, Any], params: dict[str, Any],
                  start: Optional[str] = None, end: Optional[str] = None) -> dict[str, Any]:
    s = _substitute(strategy, params)
    return rb.backtest(
        s["symbols"], s["entry"], s.get("exit", []), s.get("stop"), s.get("sizing"),
        s.get("costs_bps", 15), start or s.get("start"), end or s.get("end"),
    )


# ── TOOL: optimize ────────────────────────────────────────────────────────────

def optimize(strategy: dict[str, Any], grid: dict[str, list[Any]],
             objective: str = "sharpe") -> dict[str, Any]:
    key = _cache_key("optimize", {"s": strategy, "g": grid, "o": objective})
    if key in _cache:
        return _cache[key]

    keys = sorted(grid.keys())
    combos = list(itertools.product(*[grid[k] for k in keys]))
    truncated = len(combos) > MAX_COMBOS
    combos = combos[:MAX_COMBOS]

    results = []
    for combo in combos:
        params = dict(zip(keys, combo))
        bt = _run_strategy(strategy, params)
        if "error" in bt:
            continue
        p = bt["portfolio"]
        results.append({
            "params": params,
            "objective_value": round(_objective_value(p, objective), 4),
            "sharpe": p["sharpe"], "cagr_pct": p["cagr_pct"],
            "max_drawdown_pct": p["max_drawdown_pct"],
            "total_return_pct": p["total_return_pct"],
            "num_trades": bt["trade_stats"]["num_trades"],
        })
    if not results:
        return {"error": "No parameter combination produced trades."}

    results.sort(key=lambda r: r["objective_value"], reverse=True)
    out = {
        "objective": objective,
        "best_params": results[0]["params"],
        "best": results[0],
        "combos_tested": len(results),
        "grid_results": results,
        "truncated": truncated,
        "note": ("In-sample optimum overfits — the best params here are NOT a live edge. "
                 "Confirm with walk_forward before trusting them."),
        "data_version": data_version(),
    }
    out["result_hash"] = _hash_result(results)
    _cache[key] = out
    return out


# ── TOOL: walk_forward ────────────────────────────────────────────────────────

def walk_forward(strategy: dict[str, Any], grid: dict[str, list[Any]],
                 train_years: float = 3, test_years: float = 1,
                 objective: str = "sharpe") -> dict[str, Any]:
    key = _cache_key("walk_forward", {"s": strategy, "g": grid, "tr": train_years,
                                      "te": test_years, "o": objective})
    if key in _cache:
        return _cache[key]

    # date span from the first symbol
    sym0 = strategy["symbols"][0]
    f = _load_symbol(sym0, lookback=5000)
    if f is None:
        return {"error": f"No data for {sym0}"}
    dates = f["date"]
    years = [int(d[:4]) for d in dates]
    y0, y1 = years[0], years[-1]

    folds = []
    train_y = int(train_years)
    test_y = int(test_years)
    ts = y0 + train_y
    while ts + test_y - 1 <= y1:
        train_start = f"{ts - train_y}-01-01"
        train_end = f"{ts - 1}-12-31"
        test_start = f"{ts}-01-01"
        test_end = f"{ts + test_y - 1}-12-31"

        # in-sample optimize on train window
        best = _optimize_window(strategy, grid, objective, train_start, train_end)
        if best is None:
            ts += test_y
            continue
        # out-of-sample apply on test window
        oos = _run_strategy(strategy, best["params"], test_start, test_end)
        if "error" in oos:
            ts += test_y
            continue
        p = oos["portfolio"]
        folds.append({
            "train": f"{ts - train_y}–{ts - 1}", "test": f"{ts}–{ts + test_y - 1}",
            "params": best["params"],
            "is_sharpe": best["sharpe"], "is_cagr_pct": best["cagr_pct"],
            "oos_sharpe": p["sharpe"], "oos_cagr_pct": p["cagr_pct"],
            "oos_max_dd_pct": p["max_drawdown_pct"], "oos_trades": oos["trade_stats"]["num_trades"],
        })
        ts += test_y

    if not folds:
        return {"error": "Not enough history for the requested train/test windows."}

    oos_sharpe = [f["oos_sharpe"] for f in folds]
    oos_cagr = [f["oos_cagr_pct"] for f in folds]
    is_sharpe = [f["is_sharpe"] for f in folds]
    out = {
        "folds": folds,
        "aggregate": {
            "mean_oos_sharpe": round(float(np.mean(oos_sharpe)), 3),
            "mean_oos_cagr_pct": round(float(np.mean(oos_cagr)), 3),
            "mean_is_sharpe": round(float(np.mean(is_sharpe)), 3),
            "oos_positive_folds": int(sum(1 for s in oos_sharpe if s > 0)),
            "total_folds": len(folds),
            "degradation": round(float(np.mean(is_sharpe) - np.mean(oos_sharpe)), 3),
        },
        "note": ("OOS materially below IS = the strategy is curve-fit. Trust the OOS "
                 "column, not the IS column."),
        "data_version": data_version(),
    }
    out["result_hash"] = _hash_result(folds)
    _cache[key] = out
    return out


def _optimize_window(strategy, grid, objective, start, end) -> Optional[dict[str, Any]]:
    keys = sorted(grid.keys())
    combos = list(itertools.product(*[grid[k] for k in keys]))[:MAX_COMBOS]
    best = None
    for combo in combos:
        params = dict(zip(keys, combo))
        bt = _run_strategy(strategy, params, start, end)
        if "error" in bt:
            continue
        p = bt["portfolio"]
        val = _objective_value(p, objective)
        row = {"params": params, "sharpe": p["sharpe"], "cagr_pct": p["cagr_pct"], "_v": val}
        if best is None or val > best["_v"]:
            best = row
    return best


# ── TOOL: monte_carlo ─────────────────────────────────────────────────────────

def monte_carlo(backtest_ref: str, n_sims: int = 1000,
                method: str = "resample_returns") -> dict[str, Any]:
    key = _cache_key("monte_carlo", {"ref": backtest_ref, "n": n_sims, "m": method})
    if key in _cache:
        return _cache[key]

    handle = rb._HANDLES.get(backtest_ref)
    if handle is None:
        return {"error": f"Unknown backtest handle '{backtest_ref}'. Run backtest first."}
    trades = np.array(handle.get("trade_returns", []), dtype=float) / 100.0
    if len(trades) < 5:
        return {"error": "Too few trades for a meaningful Monte Carlo."}

    n_sims = int(min(n_sims, 5000))
    rng = np.random.default_rng(SEED)
    final_returns = np.empty(n_sims)
    max_dds = np.empty(n_sims)

    for i in range(n_sims):
        if method == "shuffle_trades":
            seq = rng.permutation(trades)
        else:  # resample_returns (bootstrap with replacement)
            seq = rng.choice(trades, size=len(trades), replace=True)
        equity = np.cumprod(1.0 + seq)
        final_returns[i] = equity[-1] - 1.0
        peak = np.maximum.accumulate(equity)
        max_dds[i] = ((equity / peak) - 1.0).min()

    def pct(a, q):
        return round(float(np.percentile(a, q) * 100), 3)

    out = {
        "backtest_ref": backtest_ref,
        "method": method,
        "n_sims": n_sims,
        "trades_per_sim": int(len(trades)),
        "total_return_pct": {"p5": pct(final_returns, 5), "p25": pct(final_returns, 25),
                             "p50": pct(final_returns, 50), "p75": pct(final_returns, 75),
                             "p95": pct(final_returns, 95)},
        "max_drawdown_pct": {"p5": pct(max_dds, 5), "p50": pct(max_dds, 50),
                             "p95": pct(max_dds, 95), "worst": round(float(max_dds.min() * 100), 3)},
        "prob_loss_pct": round(float((final_returns < 0).mean() * 100), 2),
        "note": "Distribution of outcomes from re-ordering/resampling the realized trades. "
                "Wide spread or high prob_loss = fragile strategy.",
        "data_version": data_version(),
    }
    out["result_hash"] = _hash_result(out["total_return_pct"])
    _cache[key] = out
    return out
