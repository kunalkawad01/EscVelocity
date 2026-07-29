"""Research Copilot — Phase 2 research surface: backtest, event_study, ranking.

Deterministic numpy engine over equities_prices. No FastAPI imports.
All statistics are computed here (not by the LLM). Results are cached by
(tool, canonical-input, data_version) and backtests register a result handle
so later phases (monte_carlo) can reference them.

Design note: a self-contained event-driven backtester is used instead of
vectorbt so the logic is fully deterministic and unit-testable in-repo. The
stat set (CAGR, Sharpe, max DD, win rate, profit factor, expectancy) matches
what vectorbt would report; vectorbt can be added later purely as a cross-check.
"""
from __future__ import annotations

import math
import uuid
from typing import Any, Optional

import numpy as np

from app.services import research_tools as rt
from app.services.research_tools import (
    _load_symbol, _load_universe_frames, _resolve_universe, _daily_returns,
    _rsi, _sma, _ema, _atr, data_version, _cache_key, _cache, _hash_result,
)

TRADING_DAYS = 252

# Handle store — backtest results referenceable by later tools (Phase 4).
_HANDLES: dict[str, dict[str, Any]] = {}


# ── Field time-series resolver (series form of research_tools._field_value) ────

def _field_series(field: str, f: dict[str, np.ndarray]) -> Optional[np.ndarray]:
    base, n = rt._parse_field(field)
    c, h, l, v = f["close"], f["high"], f["low"], f["volume"]
    if base in ("close", "open", "high", "low", "volume"):
        return f[base].astype(float)
    if base == "rsi":
        return _rsi(c, n or 14)
    if base == "sma":
        return _sma(c, n or 50)
    if base == "ema":
        return _ema(c, n or 20)
    if base == "atr":
        return _atr(h, l, c, n or 14)
    if base in ("ret", "return"):
        n = n or 20
        out = np.full_like(c, np.nan, dtype=float)
        if len(c) > n:
            out[n:] = (c[n:] / c[:-n] - 1.0) * 100.0
        return out
    if base in ("vol", "volatility"):
        n = n or 20
        r = _daily_returns(c)
        out = np.full_like(c, np.nan, dtype=float)
        for i in range(n, len(c)):
            out[i] = np.nanstd(r[i - n + 1:i + 1]) * math.sqrt(TRADING_DAYS) * 100.0
        return out
    if base in ("volume_ratio", "vol_ratio"):
        n = n or 20
        out = np.full_like(c, np.nan, dtype=float)
        for i in range(n, len(v)):
            avg = np.mean(v[i - n:i])
            out[i] = v[i] / avg if avg > 0 else np.nan
        return out
    if base == "above_sma":
        n = n or 200
        s = _sma(c, n)
        return (c > s).astype(float)
    return None


def _rule_series(rule: dict[str, Any], f: dict[str, np.ndarray]) -> Optional[np.ndarray]:
    x = _field_series(rule["field"], f)
    if x is None:
        return None
    val = rule["value"]
    if isinstance(val, str):  # reference to another field
        rhs = _field_series(val, f)
        if rhs is None:
            return None
    else:
        rhs = np.full_like(x, float(val), dtype=float)
    op = rule["op"]
    with np.errstate(invalid="ignore"):
        if op == "<":
            m = x < rhs
        elif op == "<=":
            m = x <= rhs
        elif op == ">":
            m = x > rhs
        elif op == ">=":
            m = x >= rhs
        elif op == "==":
            m = x == rhs
        elif op == "between":
            m = (x >= rhs) & (x <= np.full_like(x, float(val[1])))
        else:
            return None
    valid = ~(np.isnan(x) | np.isnan(rhs))
    return np.where(valid, m, False)


def _combine(rules: list[dict[str, Any]], f: dict[str, np.ndarray], how: str) -> Optional[np.ndarray]:
    series = [s for r in rules if (s := _rule_series(r, f)) is not None]
    if not series or len(series) != len(rules):
        return None
    stack = np.vstack(series)
    return stack.all(axis=0) if how == "and" else stack.any(axis=0)


# ── TOOL: backtest ────────────────────────────────────────────────────────────

def backtest(symbols: list[str], entry: list[dict[str, Any]], exit: list[dict[str, Any]],
             stop: Optional[dict[str, Any]] = None, sizing: Optional[dict[str, Any]] = None,
             costs_bps: float = 15.0, start: Optional[str] = None,
             end: Optional[str] = None) -> dict[str, Any]:
    key = _cache_key("backtest", {"sym": symbols, "entry": entry, "exit": exit,
                                  "stop": stop, "sizing": sizing, "costs": costs_bps,
                                  "start": start, "end": end})
    if key in _cache:
        return _cache[key]

    all_trades: list[dict[str, Any]] = []
    per_symbol: list[dict[str, Any]] = []
    equity_curves: list[np.ndarray] = []
    dates_ref: Optional[np.ndarray] = None

    for sym in symbols:
        f = _load_symbol(sym, lookback=3000, as_of=end)
        if f is None or len(f["close"]) < 60:
            continue
        if start:
            mask = f["date"] >= start
            f = {k: v[mask] for k, v in f.items()}
            if len(f["close"]) < 60:
                continue
        res = _bt_single(f, entry, exit, stop, costs_bps)
        if res is None:
            continue
        all_trades.extend([{**t, "symbol": sym} for t in res["trades"]])
        per_symbol.append({"symbol": sym, **res["stats"]})
        equity_curves.append(res["equity"])
        if dates_ref is None or len(f["date"]) > len(dates_ref):
            dates_ref = f["date"]

    if not per_symbol:
        return {"error": "No trades generated. Check entry/exit rules and universe."}

    # Portfolio equity = equal-weight average of per-symbol equity curves (aligned to longest)
    L = max(len(e) for e in equity_curves)
    padded = np.vstack([np.concatenate([e, np.full(L - len(e), e[-1])]) for e in equity_curves])
    port_equity = padded.mean(axis=0)
    port_stats = _equity_stats(port_equity)

    rets = np.array([t["return_pct"] for t in all_trades])
    wins = rets[rets > 0]
    losses = rets[rets < 0]
    handle = uuid.uuid4().hex[:12]

    trade_stats = {
        "num_trades": len(all_trades),
        "win_rate_pct": round(float((rets > 0).mean() * 100), 2) if len(rets) else 0.0,
        "avg_return_pct": round(float(rets.mean()), 3) if len(rets) else 0.0,
        "avg_win_pct": round(float(wins.mean()), 3) if len(wins) else 0.0,
        "avg_loss_pct": round(float(losses.mean()), 3) if len(losses) else 0.0,
        "profit_factor": round(float(wins.sum() / abs(losses.sum())), 3) if losses.sum() != 0 else None,
        "expectancy_pct": round(float(rets.mean()), 3) if len(rets) else 0.0,
        "avg_holding_days": round(float(np.mean([t["bars"] for t in all_trades])), 1) if all_trades else 0.0,
    }

    down_sample = max(1, len(port_equity) // 200)
    result = {
        "symbols": symbols,
        "as_of": str(dates_ref[-1]) if dates_ref is not None else None,
        "costs_bps": costs_bps,
        "portfolio": port_stats,
        "trade_stats": trade_stats,
        "per_symbol": sorted(per_symbol, key=lambda r: r["total_return_pct"], reverse=True)[:25],
        "equity_curve": [round(float(x), 4) for x in port_equity[::down_sample]],
        "handle": handle,
        "data_version": data_version(),
    }
    result["result_hash"] = _hash_result({"p": port_stats, "t": trade_stats})
    _HANDLES[handle] = {"trade_returns": [float(x) for x in rets],
                        "equity": [float(x) for x in port_equity]}
    _cache[key] = result
    return result


def _bt_single(f: dict[str, np.ndarray], entry: list[dict[str, Any]],
               exit: list[dict[str, Any]], stop: Optional[dict[str, Any]],
               costs_bps: float) -> Optional[dict[str, Any]]:
    c = f["close"]
    entry_sig = _combine(entry, f, "and")
    exit_sig = _combine(exit, f, "or") if exit else np.zeros(len(c), dtype=bool)
    if entry_sig is None:
        return None
    atr = _atr(f["high"], f["low"], c, 14) if stop and stop.get("type") == "atr" else None

    cost = costs_bps / 10000.0
    in_pos = False
    entry_px = 0.0
    entry_i = 0
    stop_px = 0.0
    trades: list[dict[str, Any]] = []
    daily_ret = np.zeros(len(c))  # strategy daily returns (long-only, fully invested when in pos)

    for i in range(1, len(c)):
        if in_pos:
            daily_ret[i] = c[i] / c[i - 1] - 1.0
            hit_stop = stop is not None and c[i] <= stop_px
            do_exit = bool(exit_sig[i]) or hit_stop
            if do_exit:
                exit_px = c[i]
                ret = (exit_px / entry_px - 1.0) - 2 * cost
                trades.append({"return_pct": round(ret * 100, 4), "bars": i - entry_i})
                in_pos = False
        if not in_pos and bool(entry_sig[i]) and not bool(exit_sig[i]):
            in_pos = True
            entry_px = c[i]
            entry_i = i
            if stop:
                if stop.get("type") == "atr" and atr is not None and not np.isnan(atr[i]):
                    stop_px = entry_px - float(stop.get("mult", 2)) * atr[i]
                elif stop.get("type") == "pct":
                    stop_px = entry_px * (1 - float(stop.get("value", 5)) / 100.0)
                else:
                    stop_px = 0.0
    # close any open trade at last bar
    if in_pos:
        ret = (c[-1] / entry_px - 1.0) - 2 * cost
        trades.append({"return_pct": round(ret * 100, 4), "bars": len(c) - 1 - entry_i})

    equity = np.cumprod(1.0 + daily_ret)
    return {"trades": trades, "equity": equity, "stats": _equity_stats(equity)}


def _equity_stats(equity: np.ndarray) -> dict[str, Any]:
    if len(equity) < 2:
        return {"total_return_pct": 0.0, "cagr_pct": 0.0, "sharpe": 0.0, "max_drawdown_pct": 0.0}
    total = equity[-1] / equity[0] - 1.0
    years = len(equity) / TRADING_DAYS
    cagr = (equity[-1] / equity[0]) ** (1 / years) - 1.0 if years > 0 else 0.0
    dr = np.diff(equity) / equity[:-1]
    sharpe = float(np.mean(dr) / np.std(dr) * math.sqrt(TRADING_DAYS)) if np.std(dr) > 0 else 0.0
    peak = np.maximum.accumulate(equity)
    max_dd = float(((equity / peak) - 1.0).min())
    return {
        "total_return_pct": round(float(total * 100), 3),
        "cagr_pct": round(float(cagr * 100), 3),
        "sharpe": round(sharpe, 3),
        "max_drawdown_pct": round(max_dd * 100, 3),
    }


# ── TOOL: event_study ─────────────────────────────────────────────────────────

def event_study(condition: dict[str, Any], universe: str = "nse500",
                horizons: Optional[list[int]] = None, min_occurrences: int = 30,
                direction: str = "bullish") -> dict[str, Any]:
    horizons = horizons or [5, 10, 20]
    key = _cache_key("event_study", {"cond": condition, "u": universe,
                                     "h": horizons, "min": min_occurrences, "dir": direction})
    if key in _cache:
        return _cache[key]

    sign = -1.0 if direction == "bearish" else 1.0
    symbols = _resolve_universe(universe)
    lookback = 3000
    frames = _load_universe_frames(symbols, lookback, None)

    fwd: dict[int, list[float]] = {h: [] for h in horizons}
    occurrences = 0
    for sym, f in frames.items():
        c = f["close"]
        idxs = _event_indices(condition, f)
        for t in idxs:
            for h in horizons:
                if t + h < len(c):
                    fwd[h].append((c[t + h] / c[t] - 1.0) * 100.0 * sign)
            occurrences += 1

    per_horizon = {}
    for h in horizons:
        arr = np.array(fwd[h])
        if len(arr) == 0:
            per_horizon[f"{h}d"] = {"n": 0}
            continue
        per_horizon[f"{h}d"] = {
            "n": int(len(arr)),
            "hit_rate_pct": round(float((arr > 0).mean() * 100), 2),
            "mean_pct": round(float(arr.mean()), 3),
            "median_pct": round(float(np.median(arr)), 3),
            "worst_pct": round(float(arr.min()), 3),
            "best_pct": round(float(arr.max()), 3),
            "std_pct": round(float(arr.std()), 3),
        }

    result = {
        "condition": condition,
        "direction": direction,
        "universe": universe,
        "occurrences": occurrences,
        "sufficient_sample": occurrences >= min_occurrences,
        "min_occurrences": min_occurrences,
        "horizons": per_horizon,
        "note": ("Bearish signal: forward returns are sign-flipped so positive = "
                 "the setup worked.") if direction == "bearish" else
                "Positive forward return = price rose after the event.",
        "data_version": data_version(),
    }
    result["result_hash"] = _hash_result(per_horizon)
    _cache[key] = result
    return result


def _event_indices(condition: dict[str, Any], f: dict[str, np.ndarray]) -> list[int]:
    """Support cross events and threshold events."""
    event = condition.get("event")
    c = f["close"]
    if event in ("rsi_cross_above", "rsi_cross_below"):
        level = float(condition.get("level", 30))
        r = _rsi(c, int(condition.get("period", 14)))
        prev, cur = r[:-1], r[1:]
        if event.endswith("above"):
            hit = (prev < level) & (cur >= level)
        else:
            hit = (prev > level) & (cur <= level)
        return [i + 1 for i in np.where(hit)[0]]
    if event in ("cross_above", "cross_below"):
        field = condition.get("field", "close")
        ref = condition.get("ref")
        x = _field_series(field, f)
        rhs = _field_series(ref, f) if isinstance(ref, str) else np.full_like(x, float(condition.get("value", 0)))
        if x is None or rhs is None:
            return []
        prev = x[:-1] - rhs[:-1]
        cur = x[1:] - rhs[1:]
        hit = (prev < 0) & (cur >= 0) if event.endswith("above") else (prev > 0) & (cur <= 0)
        valid = ~(np.isnan(x[1:]) | np.isnan(rhs[1:]))
        return [i + 1 for i in np.where(hit & valid)[0]]
    if event == "new_high":
        n = int(condition.get("period", 252))
        idxs = []
        for i in range(n, len(c)):
            if c[i] >= np.max(c[i - n:i]):
                idxs.append(i)
        return idxs
    # generic threshold: field op value, fire on the bar it becomes true (rising edge)
    field, op, value = condition.get("field"), condition.get("op"), condition.get("value")
    if field and op is not None:
        s = _rule_series({"field": field, "op": op, "value": value}, f)
        if s is None:
            return []
        rising = np.where((~s[:-1]) & s[1:])[0] + 1
        return list(rising)
    return []


# ── TOOL: ranking ─────────────────────────────────────────────────────────────

def ranking(factor: str, universe: str = "nse500", weights: Optional[dict[str, float]] = None,
            top_n: int = 25) -> dict[str, Any]:
    key = _cache_key("ranking", {"f": factor, "u": universe, "w": weights, "n": top_n})
    if key in _cache:
        return _cache[key]
    symbols = _resolve_universe(universe)
    frames = _load_universe_frames(symbols, 600, None)

    raw: dict[str, dict[str, float]] = {}
    for sym, f in frames.items():
        c = f["close"]
        if len(c) < 260:
            continue
        r = _daily_returns(c)
        mom = float(c[-21] / c[-252] - 1.0) * 100 if len(c) >= 252 else np.nan  # 12-1 skip-one
        vol = float(np.nanstd(r[-63:]) * math.sqrt(TRADING_DAYS) * 100)
        peak = np.maximum.accumulate(c[-252:])
        maxdd = float(((c[-252:] / peak) - 1.0).min()) * 100
        ret6m = float(c[-1] / c[-126] - 1.0) * 100 if len(c) >= 126 else np.nan
        raw[sym] = {"momentum_12_1": mom, "volatility": vol, "max_dd": maxdd, "ret_6m": ret6m}

    if not raw:
        return {"error": "insufficient history"}

    syms = list(raw.keys())

    def zrank(vals: list[float], invert: bool = False) -> np.ndarray:
        a = np.array(vals, dtype=float)
        mu, sd = np.nanmean(a), np.nanstd(a)
        z = (a - mu) / sd if sd > 0 else np.zeros_like(a)
        return -z if invert else z

    mom_z = zrank([raw[s]["momentum_12_1"] for s in syms])
    vol_z = zrank([raw[s]["volatility"] for s in syms], invert=True)
    dd_z = zrank([raw[s]["max_dd"] for s in syms])  # less negative dd = higher
    r6_z = zrank([raw[s]["ret_6m"] for s in syms])

    if factor == "momentum_12_1":
        score = mom_z
    elif factor == "volatility":
        score = vol_z
    elif factor in ("relative_strength", "quality"):
        score = 0.5 * mom_z + 0.3 * r6_z + 0.2 * dd_z
    elif factor == "composite":
        w = weights or {"momentum": 0.4, "low_vol": 0.2, "quality": 0.2, "trend": 0.2}
        score = (w.get("momentum", 0.4) * mom_z + w.get("low_vol", 0.2) * vol_z +
                 w.get("quality", 0.2) * dd_z + w.get("trend", 0.2) * r6_z)
    else:
        score = mom_z

    order = np.argsort(-score)
    ranked = []
    for rank_i, idx in enumerate(order[:top_n], 1):
        s = syms[idx]
        ranked.append({
            "rank": rank_i, "symbol": s, "score": round(float(score[idx]), 3),
            "momentum_12_1_pct": round(raw[s]["momentum_12_1"], 2),
            "volatility_pct": round(raw[s]["volatility"], 2),
            "ret_6m_pct": round(raw[s]["ret_6m"], 2),
            "max_dd_pct": round(raw[s]["max_dd"], 2),
        })
    result = {"factor": factor, "universe": universe, "top_n": top_n,
              "ranked": ranked, "data_version": data_version()}
    result["result_hash"] = _hash_result([r["symbol"] for r in ranked])
    _cache[key] = result
    return result
