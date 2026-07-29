"""Research Copilot — Anthropic tool schemas + dispatch (Phase 1).

Separate from the legacy 8-tool mcp_server/server.py. These tools are the
deterministic quant toolset over equities_prices described in
RESEARCH_COPILOT_SPEC.md §4.1. Dispatch returns a JSON string.
"""
from __future__ import annotations

import json
from typing import Any

from app.services import research_tools as rt
from app.services import research_backtest as rb
from app.services import research_sandbox as rs
from app.services import research_optimize as ro

RESEARCH_TOOLS: list[dict[str, Any]] = [
    {
        "name": "query_data",
        "description": (
            "Run a parameterized read-only query over equities_prices. Returns "
            "OHLCV rows as records. Use for raw data pulls; prefer compute_/screen "
            "for analytics."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbols": {"type": "array", "items": {"type": "string"}},
                "start": {"type": "string", "description": "YYYY-MM-DD"},
                "end": {"type": "string", "description": "YYYY-MM-DD"},
                "columns": {"type": "array", "items": {"type": "string"}},
                "universe": {"type": "string", "enum": ["nse500", "nifty50"], "default": "nse500"},
                "limit": {"type": "integer", "default": 500},
            },
            "required": [],
        },
    },
    {
        "name": "load_prices",
        "description": "Check availability + coverage of OHLCV for symbols; returns bar counts and last close.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbols": {"type": "array", "items": {"type": "string"}},
                "start": {"type": "string"},
                "end": {"type": "string"},
            },
            "required": ["symbols"],
        },
    },
    {
        "name": "compute_indicators",
        "description": (
            "Compute TA-Lib indicators for a symbol as-of a date. Replaces per-indicator "
            "tools. specs is a list like [{\"name\":\"RSI\",\"params\":{\"timeperiod\":14}}]. "
            "Supported: RSI, SMA, EMA, ATR, MACD, ADX, BBANDS, CCI, MFI, WILLR, OBV, STOCH."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "specs": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "params": {"type": "object"},
                        },
                        "required": ["name"],
                    },
                },
                "as_of": {"type": "string", "description": "YYYY-MM-DD; default latest bar"},
            },
            "required": ["symbol", "specs"],
        },
    },
    {
        "name": "compute_stats",
        "description": (
            "Statistical / EDA operations over a symbol's price/return series. ops is a "
            "list from: returns, log_returns, rolling_return, cumulative_return, volatility, "
            "std_deviation, zscore, percentile, mean, median, skewness, kurtosis, quantiles, "
            "autocorrelation, drawdown, correlation, rolling_correlation, covariance, rolling_beta. "
            "correlation ops use an equal-weighted market proxy unless a benchmark symbol is given."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "ops": {"type": "array", "items": {"type": "string"}},
                "window": {"type": "integer"},
                "benchmark": {"type": "string"},
                "start": {"type": "string"},
                "end": {"type": "string"},
            },
            "required": ["symbol", "ops"],
        },
    },
    {
        "name": "screen",
        "description": (
            "Filter the universe by compound criteria and return matching symbols with values. "
            "Powers 'all stocks below 20 RSI'. Each criterion is {field, op, value}. "
            "Fields: close, volume, rsi_<n>, sma_<n>, ema_<n>, atr_<n>, ret_<n> (n-day % return), "
            "vol_<n> (annualized %), volume_ratio_<n>, atr_percentile_<n>, above_sma_<n>, "
            "dist_52w_high, dist_52w_low. op is one of <,<=,>,>=,==,between. "
            "value is a number, a [lo,hi] pair for 'between', or another field name for "
            "comparisons like ema_20 > ema_50."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "criteria": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "field": {"type": "string"},
                            "op": {"type": "string", "enum": ["<", "<=", ">", ">=", "==", "between"]},
                            "value": {},
                        },
                        "required": ["field", "op", "value"],
                    },
                },
                "universe": {"type": "string", "enum": ["nse500", "nifty50"], "default": "nse500"},
                "as_of": {"type": "string", "description": "YYYY-MM-DD snapshot; default latest"},
                "sort_by": {"type": "string"},
                "limit": {"type": "integer", "default": 50},
            },
            "required": ["criteria"],
        },
    },
    {
        "name": "eda_profile",
        "description": (
            "One-shot EDA panel for a symbol: return distribution histogram, moments, "
            "rolling 20d volatility, drawdown, and rolling 60d correlation to the market proxy. "
            "Use this to characterize a stock before deeper analysis."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "target": {"type": "string", "description": "symbol"},
                "benchmark": {"type": "string", "default": "NIFTY"},
                "lookback_days": {"type": "integer", "default": 504},
            },
            "required": ["target"],
        },
    },
    {
        "name": "make_chart",
        "description": "Wrap a prior tool result into a chart spec for the UI. kinds: histogram, line, heatmap, scatter, bar, drawdown.",
        "input_schema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string"},
                "data_ref": {},
                "options": {"type": "object"},
            },
            "required": ["kind", "data_ref"],
        },
    },
    {
        "name": "backtest",
        "description": (
            "Backtest a long-only rule-based strategy over one or more symbols. entry and "
            "exit are lists of {field, op, value} rules (entry ANDed, exit ORed). Same field "
            "grammar as screen (rsi_14, ema_20, sma_50, atr_14, ret_20, vol_20, volume_ratio_20, "
            "above_sma_200; value may be another field name for crossovers, e.g. ema_20 > ema_50). "
            "stop: {\"type\":\"atr\",\"mult\":2} or {\"type\":\"pct\",\"value\":5}. costs_bps default 15. "
            "Returns portfolio CAGR/Sharpe/max drawdown, trade stats (win rate, profit factor, "
            "expectancy), per-symbol breakdown, and an equity curve. All stats are computed, never estimated."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbols": {"type": "array", "items": {"type": "string"}},
                "entry": {"type": "array", "items": {"type": "object"}},
                "exit": {"type": "array", "items": {"type": "object"}},
                "stop": {"type": "object"},
                "sizing": {"type": "object"},
                "costs_bps": {"type": "number", "default": 15},
                "start": {"type": "string"},
                "end": {"type": "string"},
            },
            "required": ["symbols", "entry"],
        },
    },
    {
        "name": "event_study",
        "description": (
            "Measure forward returns after an event across all historical occurrences in the "
            "universe. condition examples: {\"event\":\"rsi_cross_above\",\"level\":30}, "
            "{\"event\":\"rsi_cross_below\",\"level\":70}, {\"event\":\"new_high\",\"period\":252}, "
            "{\"event\":\"cross_above\",\"field\":\"ema_20\",\"ref\":\"ema_50\"}, or a threshold "
            "{\"field\":\"vol_20\",\"op\":\">\",\"value\":40}. horizons default [5,10,20]. Set "
            "direction:'bearish' to sign-flip returns so positive means the setup worked. Returns "
            "per-horizon hit rate, mean/median/worst/best, sample size, and whether n is sufficient."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "condition": {"type": "object"},
                "universe": {"type": "string", "enum": ["nse500", "nifty50"], "default": "nse500"},
                "horizons": {"type": "array", "items": {"type": "integer"}},
                "min_occurrences": {"type": "integer", "default": 30},
                "direction": {"type": "string", "enum": ["bullish", "bearish"], "default": "bullish"},
            },
            "required": ["condition"],
        },
    },
    {
        "name": "run_python",
        "description": (
            "ESCAPE HATCH — only when no other tool fits. Execute a short sandboxed Python "
            "snippet against read-only data. Available in scope: `df` (a pandas DataFrame with "
            "columns symbol,date,open,high,low,close,volume for the symbols you list in `frames`), "
            "`con` (a read-only DuckDB cursor over equities_prices — SELECT/WITH only), plus `np`, "
            "`pd`, `scipy`, `talib`, `vbt`. You MUST assign the answer to a variable named `result` "
            "(a number, dict, list, numpy array, or pandas DataFrame/Series). No imports beyond "
            "pandas/numpy/scipy/talib/vectorbt/math/statistics; no file, network, or OS access; "
            "20s limit. Prefer the dedicated tools (screen, backtest, event_study, compute_stats) "
            "whenever they can answer — use this only for genuinely custom analysis."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "Python; assign the answer to `result`."},
                "frames": {"type": "array", "items": {"type": "string"},
                           "description": "symbols to preload into `df` (optional)"},
            },
            "required": ["code"],
        },
    },
    {
        "name": "optimize",
        "description": (
            "Parameter-grid sweep over a strategy template. `strategy` is a backtest spec whose "
            "rules contain $placeholders (e.g. entry [{field:\"ema_$fast\",op:\">\",value:\"ema_$slow\"}]), "
            "and `grid` maps each placeholder to a list of values (e.g. {\"fast\":[10,20],\"slow\":[50,100]}). "
            "Runs a backtest per combination and returns the best by objective (sharpe/cagr/calmar) plus the "
            "full grid. WARNING it always over-fits in-sample — follow with walk_forward."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "strategy": {"type": "object", "description": "backtest spec with $placeholders; must include symbols"},
                "grid": {"type": "object", "description": "placeholder -> list of values"},
                "objective": {"type": "string", "enum": ["sharpe", "cagr", "calmar"], "default": "sharpe"},
            },
            "required": ["strategy", "grid"],
        },
    },
    {
        "name": "walk_forward",
        "description": (
            "Rolling out-of-sample validation. Each fold: optimize the grid on a train window, then apply the "
            "winning params to the following test window; repeat across history. Returns per-fold IS vs OOS "
            "performance and the degradation. This is the anti-overfit tool — trust the OOS numbers."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "strategy": {"type": "object"},
                "grid": {"type": "object"},
                "train_years": {"type": "number", "default": 3},
                "test_years": {"type": "number", "default": 1},
                "objective": {"type": "string", "enum": ["sharpe", "cagr", "calmar"], "default": "sharpe"},
            },
            "required": ["strategy", "grid"],
        },
    },
    {
        "name": "monte_carlo",
        "description": (
            "Robustness test on a completed backtest. Pass the `backtest_ref` (the handle a prior backtest "
            "returned). Resamples (bootstrap) or shuffles the realized trade sequence n_sims times to produce "
            "a distribution of total return and max drawdown, plus probability of loss. Wide spread = fragile."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "backtest_ref": {"type": "string", "description": "handle from a prior backtest result"},
                "n_sims": {"type": "integer", "default": 1000},
                "method": {"type": "string", "enum": ["resample_returns", "shuffle_trades"], "default": "resample_returns"},
            },
            "required": ["backtest_ref"],
        },
    },
    {
        "name": "ranking",
        "description": (
            "Rank the universe by a factor. factor: momentum_12_1 (12-1 skip-one return), "
            "relative_strength, volatility (low-vol ranked high), quality, or composite "
            "(supply weights {momentum, low_vol, quality, trend}). Returns the top_n symbols with "
            "z-scored factor value and supporting metrics."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "factor": {"type": "string", "enum": ["momentum_12_1", "relative_strength", "volatility", "quality", "composite"]},
                "universe": {"type": "string", "enum": ["nse500", "nifty50"], "default": "nse500"},
                "weights": {"type": "object"},
                "top_n": {"type": "integer", "default": 25},
            },
            "required": ["factor"],
        },
    },
]

_DISPATCH = {
    "query_data": lambda a: rt.query_data(
        a.get("symbols"), a.get("start"), a.get("end"), a.get("columns"),
        a.get("universe", "nse500"), a.get("limit", 500)),
    "load_prices": lambda a: rt.load_prices(a["symbols"], a.get("start"), a.get("end")),
    "compute_indicators": lambda a: rt.compute_indicators(a["symbol"], a["specs"], a.get("as_of")),
    "compute_stats": lambda a: rt.compute_stats(
        a["symbol"], a["ops"], a.get("window"), a.get("benchmark"),
        a.get("start"), a.get("end")),
    "screen": lambda a: rt.screen(
        a["criteria"], a.get("universe", "nse500"), a.get("as_of"),
        a.get("sort_by"), a.get("limit", 50)),
    "eda_profile": lambda a: rt.eda_profile(
        a["target"], a.get("benchmark", "NIFTY"), a.get("lookback_days", 504)),
    "make_chart": lambda a: rt.make_chart(a["kind"], a.get("data_ref"), a.get("options")),
    "backtest": lambda a: rb.backtest(
        a["symbols"], a["entry"], a.get("exit", []), a.get("stop"), a.get("sizing"),
        a.get("costs_bps", 15), a.get("start"), a.get("end")),
    "event_study": lambda a: rb.event_study(
        a["condition"], a.get("universe", "nse500"), a.get("horizons"),
        a.get("min_occurrences", 30), a.get("direction", "bullish")),
    "ranking": lambda a: rb.ranking(
        a["factor"], a.get("universe", "nse500"), a.get("weights"), a.get("top_n", 25)),
    "run_python": lambda a: rs.run_python(a["code"], a.get("frames")),
    "optimize": lambda a: ro.optimize(a["strategy"], a["grid"], a.get("objective", "sharpe")),
    "walk_forward": lambda a: ro.walk_forward(
        a["strategy"], a["grid"], a.get("train_years", 3), a.get("test_years", 1),
        a.get("objective", "sharpe")),
    "monte_carlo": lambda a: ro.monte_carlo(
        a["backtest_ref"], a.get("n_sims", 1000), a.get("method", "resample_returns")),
}


def dispatch_research_tool(name: str, args: dict[str, Any]) -> str:
    handler = _DISPATCH.get(name)
    if handler is None:
        return json.dumps({"error": f"Unknown tool: {name}"})
    try:
        return json.dumps(handler(args), default=str)
    except Exception as exc:  # pragma: no cover
        return json.dumps({"error": f"Dispatch error in {name}: {exc}"})


def to_openai_tools() -> list[dict[str, Any]]:
    """Convert the Anthropic-style schemas to OpenAI function-tool format.

    aicredits.in is an OpenAI-compatible proxy (chat/completions, `tool_calls`),
    so the agentic loop uses the `openai` SDK with function-shaped tools. The
    single source of truth stays RESEARCH_TOOLS (Anthropic shape) — this just
    remaps input_schema → function.parameters.
    """
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["input_schema"],
            },
        }
        for t in RESEARCH_TOOLS
    ]
