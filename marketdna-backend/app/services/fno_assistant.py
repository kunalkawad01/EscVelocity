"""F&O Tactical AI Desk — tool-use loop over live F&O data via a third-party proxy.

Same architecture as app/services/ai_assistant.py (User -> LLM -> tool -> Feature
Store; the LLM never invents a metric, it always calls a tool first) but a
different transport: aicredits.in is an OpenAI-compatible proxy (chat/completions,
`choices`/`tool_calls`), NOT Anthropic's native Messages API — confirmed against
https://aicredits.in/docs/api-reference. This module therefore uses the `openai`
SDK pointed at AICREDIT_BASE_URL, with OpenAI-shaped function-tool definitions,
even though the model behind it is Claude. Do not swap this for the `anthropic`
SDK unless the proxy's request/response shape changes.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

import numpy as np
import openai
import pandas as pd
import talib
import vectorbt as vbt

from app.services import fno_tactical_service as svc
from app.services import live_trading_service as lts
from app.services.duckdb_client import get_connection

log = logging.getLogger(__name__)

API_KEY   = os.environ.get("AICREDIT_API_KEY")
BASE_URL  = os.environ.get("AICREDIT_BASE_URL", "https://api.aicredits.in/v1")
MODEL     = os.environ.get("AICREDIT_MODEL", "claude-sonnet-5")
MAX_IT    = 6  # fewer tools than the stock copilot — the loop rarely needs more than 2

SYSTEM = """You are the F&O Tactical AI Desk — a quantitative analyst for the live \
F&O intraday dashboard covering NSE F&O stocks.

## Non-negotiable rules

1. NEVER invent a price, OI figure, quadrant, grade, breadth verdict, or statistic \
(moving average, std dev, variance, z-score) yourself. Always call a tool first — \
every number in your answer must come from a tool result.
2. If the market state tool reports the market is not LIVE, say so plainly before \
answering — figures may be from the last EOD close, not live.
3. Be concise: 3-6 sentences unless the user asks for more detail.
4. Options edge comes from volatility mispricing (straddle width, PCR, gamma wall), \
not from predicting direction — frame option-chain answers that way.
5. This is a research tool, not a signal-selling service — describe what the data \
shows and let the user decide; do not tell the user to "buy" or "sell".

## Dashboard concepts (for interpreting tool results, do not recompute these)

- **Quadrant** = sign(price change) x sign(OI change): LONG_BUILDUP (price up, OI up — \
fresh longs), SHORT_COVERING (price up, OI down — shorts exiting), SHORT_BUILDUP \
(price down, OI up — fresh shorts), LONG_UNWINDING (price down, OI down — longs exiting).
- **Extended** = |return / ATR| > 1.5 — the intraday pullback window is likely spent.
- **Breadth verdict**: RISK_ON if %above-VWAP > 60 and Nifty > 0 since 9:15 and \
adv/decl > 1.5; RISK_OFF is the mirror; else NEUTRAL. Gates whether longs/shorts are enabled.
- **Grade**: A = fresh conviction (OI moving with price, in LONG_BUILDUP/SHORT_BUILDUP \
depending on direction); B = the other side capitulating (SHORT_COVERING/LONG_UNWINDING) \
— half size. Grade is NONE when the setup fails the trend, gate, or extended-move filter.
- **Gamma wall / straddle / PCR** (option chain): gamma wall is the strike with the \
heaviest combined OI (a magnet/resistance level); straddle is the ATM call+put premium \
(expected move); PCR > 1 skews put-heavy (support-side crowding).

## Available tools (call these — never compute manually)

- get_fno_market_state() -> is the market LIVE, and what session date is this frame from
- get_fno_breadth() -> market-wide RISK_ON/OFF/NEUTRAL verdict + components
- get_fno_universe_summary() -> graded signals (A/B) and the biggest ATR-adjusted movers \
across the F&O universe, with quadrant/trend/rel-strength per symbol
- get_fno_optionchain(symbol) -> ATM+-3 strike ladder, straddle, PCR, gamma wall for one symbol
- get_fno_quant_calc(symbol, calc, field, window) -> a single aggregate statistic \
(moving average, std dev, variance, z-score, annualized volatility, mean, min, max) \
over a symbol's trailing daily closes or daily % returns. Use this for ONE summary \
number — never compute it yourself from other tool results.
- get_fno_series_calc(symbol, source, transform, window, compare_symbol, compare_op, \
output, tail) -> the general-purpose data tool. Pick a source (close/high/low/volume/ \
return), optionally apply a rolling transform (rolling_mean/rolling_std/ \
rolling_zscore/cumulative_return/abs/diff), or compare against a second real NSE \
symbol (ratio/diff/correlation/beta vs compare_symbol — there is no single "NIFTY" \
symbol in this data, compare against an actual stock instead). Choose output: \
"series" (day-by-day list, e.g. "show me the last 5 days' returns"), "latest" (one \
value), or "summary" (mean/std/min/max over the result). Use this for ANY numeric \
request that quant_calc's single aggregate can't answer — never estimate it yourself.
- get_fno_ta_indicator(symbol, indicator, period, ...) -> a technical indicator (RSI, \
SMA, EMA, ATR, ADX, MACD, BBANDS, STOCH) computed by TA-Lib over daily price history.
- get_fno_live_quote(symbol) -> read-only current Kite quote (LTP, OHLC, volume) for \
one symbol — no order placement exists anywhere in this system; this tool only reads.
- get_fno_backtest(symbol, strategy_id, ...) -> a vectorized historical backtest \
(sma_crossover, rsi_meanreversion, bbands_breakout) via VectorBT — win rate, Sharpe, \
max drawdown, trade count. This is a real backtest over history, never a live signal.
"""

# OpenAI function-tool shape: {"type": "function", "function": {name, description, parameters}}
# — NOT Anthropic's {name, description, input_schema}. aicredits.in speaks this shape only.
TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_fno_market_state",
            "description": (
                "Get whether the market is currently LIVE, PRE_OPEN, CLOSED, or HOLIDAY, "
                "and which session date the dashboard frame is showing. Call this first "
                "when the user asks about 'right now' or 'today'."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fno_breadth",
            "description": (
                "Get the market-wide breadth verdict (RISK_ON | RISK_OFF | NEUTRAL) and its "
                "components (% above VWAP, advance/decline ratio, Nifty return since 9:15). "
                "Call this when the user asks whether it's a good day to trade, or why longs "
                "or shorts are gated on/off."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fno_universe_summary",
            "description": (
                "Get the current graded (A/B) trading signals and the biggest risk-adjusted "
                "movers across the F&O universe, each with quadrant, trend, and relative "
                "strength. Call this when the user asks what looks good right now, which "
                "symbols are in a given quadrant, or wants a market scan."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fno_optionchain",
            "description": (
                "Get the live ATM+-3 strike option chain for one F&O symbol: spot, ATM "
                "strike, straddle price, breakeven range, total PCR, and the gamma wall. "
                "Call this when the user asks about a specific symbol's option chain, "
                "expected move, or support/resistance from OI."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "NSE F&O ticker symbol, e.g. 'RELIANCE'"},
                },
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fno_quant_calc",
            "description": (
                "Compute a basic statistic over a symbol's trailing daily closing prices "
                "or daily % returns: moving_avg, mean, min, max, variance, std_dev, "
                "zscore, or annualized_vol. Use this for any calculation the user asks "
                "for (volatility, z-score, moving average, etc.) instead of estimating "
                "it yourself. annualized_vol requires field='return'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "NSE ticker symbol, e.g. 'RELIANCE'"},
                    "calc": {
                        "type": "string",
                        "enum": ["mean", "min", "max", "moving_avg", "variance", "std_dev", "zscore", "annualized_vol"],
                        "description": "Which statistic to compute.",
                    },
                    "field": {
                        "type": "string",
                        "enum": ["close", "return"],
                        "description": (
                            "Compute over daily closing price ('close') or daily % return "
                            "('return'). Default 'close'. annualized_vol requires 'return'."
                        ),
                    },
                    "window": {
                        "type": "integer",
                        "description": "Trailing lookback window in trading days. Default 20.",
                    },
                },
                "required": ["symbol", "calc"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fno_series_calc",
            "description": (
                "General-purpose data tool: pick a source series, optionally transform "
                "it with a rolling operation, or compare it against a second symbol, "
                "then choose the output shape. Covers 'show me the last N days of X', "
                "'rolling 20-day volatility over time', 'correlation with symbol Y', "
                "'cumulative return', etc. — anything get_fno_quant_calc's single "
                "aggregate can't answer. Never estimate this yourself."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "NSE ticker symbol, e.g. 'RELIANCE'"},
                    "source": {
                        "type": "string",
                        "enum": ["close", "high", "low", "volume", "return"],
                        "description": "Base series. 'return' = daily % change of close. Default 'close'.",
                    },
                    "transform": {
                        "type": "string",
                        "enum": ["none", "rolling_mean", "rolling_std", "rolling_zscore", "cumulative_return", "abs", "diff"],
                        "description": (
                            "Optional rolling transform applied to the source series. "
                            "Ignored if compare_symbol is set. Default 'none'."
                        ),
                    },
                    "window": {
                        "type": "integer",
                        "description": "Window size for rolling_* transforms and for correlation/beta. Default 20.",
                    },
                    "compare_symbol": {
                        "type": "string",
                        "description": "Second NSE ticker to compare against. Required if compare_op is set.",
                    },
                    "compare_op": {
                        "type": "string",
                        "enum": ["none", "ratio", "diff", "correlation", "beta"],
                        "description": (
                            "How to combine with compare_symbol's same source series. "
                            "correlation/beta are rolling over `window` days. Default 'none'."
                        ),
                    },
                    "output": {
                        "type": "string",
                        "enum": ["series", "latest", "summary"],
                        "description": (
                            "'series' = day-by-day list (use `tail` to size it), "
                            "'latest' = one value, 'summary' = mean/std/min/max over "
                            "the result. Default 'series'."
                        ),
                    },
                    "tail": {
                        "type": "integer",
                        "description": "How many trailing points to include when output='series'. Default 10, max 90.",
                    },
                },
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fno_live_quote",
            "description": (
                "Get the current read-only Kite quote for one symbol: LTP, open, "
                "high, low, previous close, VWAP, volume. Live during market hours, "
                "EOD-fallback when closed. This tool only reads — there is no order "
                "placement anywhere in this system."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "NSE ticker symbol, e.g. 'RELIANCE'"},
                },
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fno_ta_indicator",
            "description": (
                "Compute a technical indicator (RSI, SMA, EMA, ATR, ADX, MACD, BBANDS, "
                "STOCH) over a symbol's daily price history using TA-Lib. Use this for "
                "any indicator-based question instead of estimating the value yourself."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "NSE ticker symbol, e.g. 'RELIANCE'"},
                    "indicator": {
                        "type": "string",
                        "enum": ["RSI", "SMA", "EMA", "ATR", "ADX", "MACD", "BBANDS", "STOCH"],
                        "description": "Which indicator to compute.",
                    },
                    "period": {
                        "type": "integer",
                        "description": "Lookback period in trading days. Default 14 (RSI/ATR/ADX/STOCH) or 20 (SMA/EMA/BBANDS).",
                    },
                    "fast": {"type": "integer", "description": "MACD only: fast EMA period. Default 12."},
                    "slow": {"type": "integer", "description": "MACD only: slow EMA period. Default 26."},
                    "signal": {"type": "integer", "description": "MACD only: signal EMA period. Default 9."},
                },
                "required": ["symbol", "indicator"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fno_backtest",
            "description": (
                "Run a vectorized historical backtest of a simple, well-known strategy "
                "template on a symbol using VectorBT, returning win rate, Sharpe ratio, "
                "max drawdown, and trade count. Use this when the user asks whether a "
                "strategy 'actually works' or wants historical performance — never "
                "estimate a win rate or Sharpe ratio yourself. This describes past "
                "behavior only; it is not a live trading signal."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "NSE ticker symbol, e.g. 'RELIANCE'"},
                    "strategy_id": {
                        "type": "string",
                        "enum": ["sma_crossover", "rsi_meanreversion", "bbands_breakout"],
                        "description": (
                            "sma_crossover: long while fast SMA > slow SMA. "
                            "rsi_meanreversion: long while RSI is oversold, exit when overbought. "
                            "bbands_breakout: long on a close above the upper Bollinger Band, "
                            "exit on a close below the middle band."
                        ),
                    },
                    "fast": {"type": "integer", "description": "sma_crossover only: fast SMA window. Default 20."},
                    "slow": {"type": "integer", "description": "sma_crossover only: slow SMA window. Default 50."},
                    "period": {
                        "type": "integer",
                        "description": "rsi_meanreversion / bbands_breakout: indicator window. Default 14 or 20.",
                    },
                    "oversold": {"type": "number", "description": "rsi_meanreversion only: RSI entry threshold. Default 30."},
                    "overbought": {"type": "number", "description": "rsi_meanreversion only: RSI exit threshold. Default 70."},
                },
                "required": ["symbol", "strategy_id"],
            },
        },
    },
]

_CALC_TYPES = {"mean", "min", "max", "moving_avg", "variance", "std_dev", "zscore", "annualized_vol"}
_QUANT_WINDOW_MIN = 2
_QUANT_WINDOW_MAX = 500

_SOURCES = {"close", "high", "low", "volume", "return"}
_TRANSFORMS = {"none", "rolling_mean", "rolling_std", "rolling_zscore", "cumulative_return", "abs", "diff"}
_COMPARE_OPS = {"none", "ratio", "diff", "correlation", "beta"}
_OUTPUTS = {"series", "latest", "summary"}
_SERIES_WINDOW_MIN = 2
_SERIES_WINDOW_MAX = 250
_SERIES_TAIL_MIN = 1
_SERIES_TAIL_MAX = 90

_TA_INDICATORS = {"RSI", "SMA", "EMA", "ATR", "ADX", "MACD", "BBANDS", "STOCH"}
# Extra warm-up bars beyond `period` needed for TA-Lib to produce a stable (non-NaN) reading.
_TA_WARMUP = {"RSI": 3, "SMA": 1, "EMA": 3, "ATR": 3, "ADX": 15, "MACD": 10, "BBANDS": 1, "STOCH": 5}

_BACKTEST_STRATEGIES = {"sma_crossover", "rsi_meanreversion", "bbands_breakout"}
_BACKTEST_MIN_BARS = 260  # ~1 trading year, so win rate / Sharpe mean something


def _row_summary(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "symbol": r["symbol"],
        "sector": r.get("sector"),
        "ret_pct": r["ret_pct"],
        "ret_per_atr": r["ret_per_atr"],
        "oi_chg_pct": r.get("oi_chg_pct"),
        "quadrant": r.get("quadrant"),
        "trend": r["trend"],
        "rel_strength": r["rel_strength"],
        "extended": r["extended"],
        "grade": r["grade"],
    }


def _tool_market_state(_args: dict[str, Any]) -> dict[str, Any]:
    return svc.get_state()


def _tool_breadth(_args: dict[str, Any]) -> dict[str, Any]:
    return svc.get_breadth()


def _tool_universe_summary(_args: dict[str, Any]) -> dict[str, Any]:
    u = svc.get_universe()
    rows = u["rows"]
    graded = [r for r in rows if r["grade"]["grade"] != "NONE"]
    # Cap the payload — an LLM tool result should be a summary, not a 500-row dump.
    top_movers = sorted(rows, key=lambda r: abs(r.get("ret_per_atr") or 0), reverse=True)[:15]
    return {
        "as_of": u["as_of"],
        "state": u["state"],
        "data_mode": u["data_mode"],
        "nifty_ret": u["nifty_ret"],
        "total_symbols_scanned": len(rows),
        "graded_signals": [_row_summary(r) for r in graded],
        "top_movers_by_atr": [_row_summary(r) for r in top_movers],
    }


def _tool_optionchain(args: dict[str, Any]) -> dict[str, Any]:
    return svc.get_optionchain(str(args["symbol"]).upper())


def _fetch_closes(symbol: str) -> tuple[list[str], np.ndarray]:
    """Full daily close history for a symbol, ascending by date."""
    con = get_connection()
    rows = con.execute(
        "SELECT date, close FROM equities_prices WHERE symbol = ? ORDER BY date",
        [symbol],
    ).fetchall()
    dates = [str(r[0])[:10] for r in rows]
    closes = np.array([float(r[1]) for r in rows])
    return dates, closes


def _tool_quant_calc(args: dict[str, Any]) -> dict[str, Any]:
    """Basic stats (mean/min/max/moving_avg/variance/std_dev/zscore/annualized_vol)
    over a symbol's trailing daily closes or daily % returns. The LLM never computes
    these itself — this is the one place the actual arithmetic happens (Core Principle 2).
    """
    symbol = str(args["symbol"]).upper()
    calc = str(args.get("calc", "")).lower()
    field = str(args.get("field", "close")).lower()
    window = int(args.get("window", 20))

    if calc not in _CALC_TYPES:
        return {"error": f"Unknown calc '{calc}'. Valid: {sorted(_CALC_TYPES)}"}
    if field not in ("close", "return"):
        return {"error": f"Unknown field '{field}'. Valid: ['close', 'return']"}
    if calc == "annualized_vol" and field != "return":
        return {"error": "annualized_vol requires field='return'"}
    if not (_QUANT_WINDOW_MIN <= window <= _QUANT_WINDOW_MAX):
        return {"error": f"window must be between {_QUANT_WINDOW_MIN} and {_QUANT_WINDOW_MAX}"}

    dates, closes = _fetch_closes(symbol)

    if field == "return":
        min_bars = window + 2
        if len(closes) < min_bars:
            return {"error": f"{symbol}: only {len(closes)} bars of history, need >= {min_bars}"}
        series = (closes[1:] / closes[:-1] - 1.0) * 100.0  # daily % return
        series_dates = dates[1:]
    else:
        if len(closes) < window:
            return {"error": f"{symbol}: only {len(closes)} bars of history, need >= {window}"}
        series = closes
        series_dates = dates

    w = series[-window:]

    if calc in ("mean", "moving_avg"):
        value = float(np.mean(w))
    elif calc == "min":
        value = float(np.min(w))
    elif calc == "max":
        value = float(np.max(w))
    elif calc == "variance":
        value = float(np.var(w, ddof=1))
    elif calc == "std_dev":
        value = float(np.std(w, ddof=1))
    elif calc == "annualized_vol":
        value = float(np.std(w, ddof=1) * np.sqrt(252))
    else:  # zscore
        sigma = float(np.std(w, ddof=1))
        value = float((w[-1] - np.mean(w)) / sigma) if sigma > 0 else 0.0

    return {
        "symbol": symbol,
        "calc": calc,
        "field": field,
        "field_unit": "%" if field == "return" else "INR",
        "window": window,
        "value": round(value, 4),
        "as_of": series_dates[-1],
    }


def _fetch_field_series(symbol: str, source: str) -> tuple[list[str], np.ndarray]:
    """Raw daily series for one OHLCV field, or 'return' (daily % change of close)."""
    con = get_connection()
    rows = con.execute(
        "SELECT date, close, high, low, volume FROM equities_prices WHERE symbol = ? ORDER BY date",
        [symbol],
    ).fetchall()
    dates = [str(r[0])[:10] for r in rows]
    closes = np.array([float(r[1]) for r in rows])

    if source == "close":
        return dates, closes
    if source == "high":
        return dates, np.array([float(r[2]) for r in rows])
    if source == "low":
        return dates, np.array([float(r[3]) for r in rows])
    if source == "volume":
        return dates, np.array([float(r[4] or 0) for r in rows])
    # return
    return dates[1:], (closes[1:] / closes[:-1] - 1.0) * 100.0


def _apply_transform(values: np.ndarray, transform: str, window: int) -> np.ndarray:
    s = pd.Series(values)
    if transform == "none":
        return s.to_numpy()
    if transform == "rolling_mean":
        return s.rolling(window).mean().to_numpy()
    if transform == "rolling_std":
        return s.rolling(window).std(ddof=1).to_numpy()
    if transform == "rolling_zscore":
        m, sd = s.rolling(window).mean(), s.rolling(window).std(ddof=1)
        return ((s - m) / sd).to_numpy()
    if transform == "cumulative_return":
        return (((1 + s / 100.0).cumprod() - 1) * 100.0).to_numpy()
    if transform == "abs":
        return s.abs().to_numpy()
    return s.diff().to_numpy()  # diff


def _apply_compare(
    dates: list[str], values: np.ndarray, compare_symbol: str, compare_op: str, source: str, window: int,
) -> tuple[list[str], np.ndarray]:
    c_dates, c_values = _fetch_field_series(compare_symbol, source)
    common = sorted(set(dates) & set(c_dates))
    if len(common) < 2:
        raise ValueError(f"{compare_symbol}: no overlapping history with the primary symbol")
    idx_a = {d: i for i, d in enumerate(dates)}
    idx_b = {d: i for i, d in enumerate(c_dates)}
    a = np.array([values[idx_a[d]] for d in common])
    b = np.array([c_values[idx_b[d]] for d in common])

    if compare_op == "ratio":
        return common, a / b
    if compare_op == "diff":
        return common, a - b
    sa, sb = pd.Series(a), pd.Series(b)
    if compare_op == "correlation":
        return common, sa.rolling(window).corr(sb).to_numpy()
    cov = sa.rolling(window).cov(sb)
    var = sb.rolling(window).var(ddof=1)
    return common, (cov / var).to_numpy()  # beta


def _result_unit(source: str, transform: str, compare_op: str) -> str:
    """Display unit for a series_calc result, in priority order: comparison shape
    first (correlation/ratio/beta are dimensionless regardless of source), then
    transform shape (zscore/cumulative_return override the source's own unit),
    then the source field's own natural unit.
    """
    if compare_op == "correlation":
        return "corr (-1 to 1)"
    if compare_op in ("ratio", "beta"):
        return "ratio"
    if transform == "rolling_zscore":
        return "z"
    if transform == "cumulative_return":
        return "%"
    if source == "return":
        return "%"
    if source == "volume":
        return "shares"
    return "INR"  # close/high/low, and compare_op="diff" of a price field


def _tool_series_calc(args: dict[str, Any]) -> dict[str, Any]:
    """General-purpose composable data tool: source -> [transform | compare] -> output.

    Every step is a typed, whitelisted operation (no LLM-supplied code/expressions) —
    this replaces get_fno_daily_series and covers rolling stats, cross-symbol
    comparisons, and cumulative returns that a single aggregate can't answer.
    """
    symbol = str(args["symbol"]).upper()
    source = str(args.get("source", "close")).lower()
    transform = str(args.get("transform", "none")).lower()
    window = int(args.get("window", 20))
    compare_symbol = args.get("compare_symbol")
    compare_op = str(args.get("compare_op", "none")).lower()
    output = str(args.get("output", "series")).lower()
    tail = int(args.get("tail", 10))

    if source not in _SOURCES:
        return {"error": f"Unknown source '{source}'. Valid: {sorted(_SOURCES)}"}
    if transform not in _TRANSFORMS:
        return {"error": f"Unknown transform '{transform}'. Valid: {sorted(_TRANSFORMS)}"}
    if compare_op not in _COMPARE_OPS:
        return {"error": f"Unknown compare_op '{compare_op}'. Valid: {sorted(_COMPARE_OPS)}"}
    if output not in _OUTPUTS:
        return {"error": f"Unknown output '{output}'. Valid: {sorted(_OUTPUTS)}"}
    if compare_op != "none" and not compare_symbol:
        return {"error": "compare_symbol is required when compare_op is set"}
    if not (_SERIES_WINDOW_MIN <= window <= _SERIES_WINDOW_MAX):
        return {"error": f"window must be between {_SERIES_WINDOW_MIN} and {_SERIES_WINDOW_MAX}"}
    if not (_SERIES_TAIL_MIN <= tail <= _SERIES_TAIL_MAX):
        return {"error": f"tail must be between {_SERIES_TAIL_MIN} and {_SERIES_TAIL_MAX}"}

    dates, values = _fetch_field_series(symbol, source)

    if compare_op != "none":
        dates, values = _apply_compare(dates, values, str(compare_symbol).upper(), compare_op, source, window)
    elif transform != "none":
        values = _apply_transform(values, transform, window)

    valid = ~np.isnan(values.astype(float))
    dates_v = [d for d, m in zip(dates, valid) if m]
    values_v = values[valid]

    if len(values_v) == 0:
        return {"error": "No valid values produced — try a larger window or different parameters"}

    meta = {
        "symbol": symbol, "source": source, "transform": transform,
        "compare_symbol": compare_symbol, "compare_op": compare_op,
        "unit": _result_unit(source, transform, compare_op),
    }

    if output == "latest":
        meta.update({"value": round(float(values_v[-1]), 4), "as_of": dates_v[-1]})
        return meta
    if output == "summary":
        meta.update({
            "mean": round(float(np.mean(values_v)), 4),
            "std": round(float(np.std(values_v, ddof=1)), 4) if len(values_v) > 1 else None,
            "min": round(float(np.min(values_v)), 4),
            "max": round(float(np.max(values_v)), 4),
            "count": len(values_v),
            "as_of": dates_v[-1],
        })
        return meta

    n = min(tail, len(values_v))
    meta["series"] = [{"date": d, "value": round(float(v), 4)} for d, v in zip(dates_v[-n:], values_v[-n:])]
    return meta


def _tool_live_quote(args: dict[str, Any]) -> dict[str, Any]:
    """Read-only current Kite quote (LTP/OHLC/volume) — no order methods exposed."""
    symbol = str(args["symbol"]).upper()
    hist = lts._get_hist()
    if symbol not in hist:
        return {"error": f"{symbol}: not in the tracked F&O universe"}
    quotes, data_mode = lts._get_quotes(hist, [symbol])
    q = quotes.get(symbol)
    if not q:
        return {"error": f"{symbol}: no quote available right now"}
    return {
        "symbol": symbol,
        "data_mode": data_mode,  # "live" or "eod_fallback"
        "ltp": q["ltp"],
        "open": q["open"],
        "high": q["high"],
        "low": q["low"],
        "prev_close": q["prev_close"],
        "vwap": q.get("vwap"),
        "volume": q.get("volume", 0),
    }


def _fetch_ohlc(symbol: str) -> pd.DataFrame:
    """Full daily OHLC history for a symbol, ascending by date, DatetimeIndex."""
    con = get_connection()
    rows = con.execute(
        "SELECT date, high, low, close FROM equities_prices WHERE symbol = ? ORDER BY date",
        [symbol],
    ).fetchall()
    if not rows:
        return pd.DataFrame(columns=["high", "low", "close"])
    dates = pd.to_datetime([str(r[0])[:10] for r in rows])
    return pd.DataFrame(
        {
            "high": [float(r[1]) for r in rows],
            "low": [float(r[2]) for r in rows],
            "close": [float(r[3]) for r in rows],
        },
        index=dates,
    )


def _last_valid(arr: np.ndarray, label: str) -> float:
    value = float(arr[-1])
    if np.isnan(value):
        raise ValueError(f"{label} produced NaN — try a larger window or check for price-history gaps")
    return value


def _tool_ta_indicator(args: dict[str, Any]) -> dict[str, Any]:
    """TA-Lib indicator over daily OHLC history — the LLM picks the indicator and
    period, TA-Lib does the actual math (Core Principle 2: never invent a number).
    """
    symbol = str(args["symbol"]).upper()
    indicator = str(args.get("indicator", "")).upper()

    if indicator not in _TA_INDICATORS:
        return {"error": f"Unknown indicator '{indicator}'. Valid: {sorted(_TA_INDICATORS)}"}

    default_period = 20 if indicator in ("SMA", "EMA", "BBANDS") else 14
    period = int(args.get("period", default_period))
    if period < 2:
        return {"error": "period must be >= 2"}

    df = _fetch_ohlc(symbol)
    min_bars = period + _TA_WARMUP[indicator]
    if len(df) < min_bars:
        return {"error": f"{symbol}: only {len(df)} bars of history, need >= {min_bars} for {indicator}({period})"}

    high, low, close = df["high"].to_numpy(), df["low"].to_numpy(), df["close"].to_numpy()
    as_of = df.index[-1].strftime("%Y-%m-%d")

    if indicator == "RSI":
        value = _last_valid(talib.RSI(close, timeperiod=period), "RSI")
        return {"symbol": symbol, "indicator": "RSI", "period": period, "value": round(value, 4), "as_of": as_of}
    if indicator == "SMA":
        value = _last_valid(talib.SMA(close, timeperiod=period), "SMA")
        return {"symbol": symbol, "indicator": "SMA", "period": period, "value": round(value, 4), "as_of": as_of}
    if indicator == "EMA":
        value = _last_valid(talib.EMA(close, timeperiod=period), "EMA")
        return {"symbol": symbol, "indicator": "EMA", "period": period, "value": round(value, 4), "as_of": as_of}
    if indicator == "ATR":
        value = _last_valid(talib.ATR(high, low, close, timeperiod=period), "ATR")
        return {"symbol": symbol, "indicator": "ATR", "period": period, "value": round(value, 4), "as_of": as_of}
    if indicator == "ADX":
        value = _last_valid(talib.ADX(high, low, close, timeperiod=period), "ADX")
        return {"symbol": symbol, "indicator": "ADX", "period": period, "value": round(value, 4), "as_of": as_of}
    if indicator == "MACD":
        fast = int(args.get("fast", 12))
        slow = int(args.get("slow", 26))
        signal = int(args.get("signal", 9))
        macd, sig, hist = talib.MACD(close, fastperiod=fast, slowperiod=slow, signalperiod=signal)
        return {
            "symbol": symbol, "indicator": "MACD", "fast": fast, "slow": slow, "signal": signal,
            "macd": round(_last_valid(macd, "MACD"), 4),
            "signal_line": round(_last_valid(sig, "MACD signal"), 4),
            "histogram": round(_last_valid(hist, "MACD histogram"), 4),
            "as_of": as_of,
        }
    if indicator == "BBANDS":
        upper, middle, lower = talib.BBANDS(close, timeperiod=period, nbdevup=2, nbdevdn=2)
        return {
            "symbol": symbol, "indicator": "BBANDS", "period": period,
            "upper": round(_last_valid(upper, "BBANDS upper"), 4),
            "middle": round(_last_valid(middle, "BBANDS middle"), 4),
            "lower": round(_last_valid(lower, "BBANDS lower"), 4),
            "last_close": round(float(close[-1]), 4),
            "as_of": as_of,
        }
    # STOCH
    slowk, slowd = talib.STOCH(high, low, close)
    return {
        "symbol": symbol, "indicator": "STOCH",
        "slowk": round(_last_valid(slowk, "STOCH %K"), 4),
        "slowd": round(_last_valid(slowd, "STOCH %D"), 4),
        "as_of": as_of,
    }


def _tool_backtest(args: dict[str, Any]) -> dict[str, Any]:
    """Vectorized historical backtest of a whitelisted strategy template via VectorBT.

    Only pre-defined, parameterized templates run here — the LLM never supplies
    code, only parameters. Describes past behavior only, not a live signal.
    """
    symbol = str(args["symbol"]).upper()
    strategy_id = str(args.get("strategy_id", "")).lower()

    if strategy_id not in _BACKTEST_STRATEGIES:
        return {"error": f"Unknown strategy_id '{strategy_id}'. Valid: {sorted(_BACKTEST_STRATEGIES)}"}

    df = _fetch_ohlc(symbol)
    if len(df) < _BACKTEST_MIN_BARS:
        return {"error": f"{symbol}: only {len(df)} bars of history, need >= {_BACKTEST_MIN_BARS} for a meaningful backtest"}

    close = df["close"]

    if strategy_id == "sma_crossover":
        fast = int(args.get("fast", 20))
        slow = int(args.get("slow", 50))
        if fast >= slow:
            return {"error": "fast window must be smaller than slow window"}
        fast_ma = vbt.MA.run(close, fast).ma
        slow_ma = vbt.MA.run(close, slow).ma
        entries = fast_ma.vbt.crossed_above(slow_ma)
        exits = fast_ma.vbt.crossed_below(slow_ma)
        label = f"SMA({fast}) x SMA({slow}) crossover"
        params_used: dict[str, Any] = {"fast": fast, "slow": slow}
    elif strategy_id == "rsi_meanreversion":
        period = int(args.get("period", 14))
        oversold = float(args.get("oversold", 30))
        overbought = float(args.get("overbought", 70))
        rsi = vbt.RSI.run(close, period).rsi
        entries = rsi < oversold
        exits = rsi > overbought
        label = f"RSI({period}) mean reversion ({oversold}/{overbought})"
        params_used = {"period": period, "oversold": oversold, "overbought": overbought}
    else:  # bbands_breakout
        period = int(args.get("period", 20))
        bb = vbt.BBANDS.run(close, window=period)
        entries = close.vbt.crossed_above(bb.upper)
        exits = close.vbt.crossed_below(bb.middle)
        label = f"Bollinger({period}) breakout"
        params_used = {"period": period}

    pf = vbt.Portfolio.from_signals(close, entries, exits, freq="1D", init_cash=100_000)
    n_trades = int(pf.trades.count())

    result: dict[str, Any] = {
        "symbol": symbol,
        "strategy_id": strategy_id,
        "label": label,
        "params": params_used,
        "bars": len(df),
        "period": f"{df.index[0].date()} to {df.index[-1].date()}",
        "trades": n_trades,
    }
    if n_trades == 0:
        result["note"] = "No trades fired historically with these parameters over the available history."
        return result

    result.update({
        "win_rate_pct": round(float(pf.trades.win_rate()) * 100, 2),
        "total_return_pct": round(float(pf.total_return()) * 100, 2),
        "sharpe_ratio": round(float(pf.sharpe_ratio()), 3),
        "max_drawdown_pct": round(float(pf.max_drawdown()) * 100, 2),
    })
    return result


_DISPATCH: dict[str, Any] = {
    "get_fno_market_state":      _tool_market_state,
    "get_fno_breadth":           _tool_breadth,
    "get_fno_universe_summary":  _tool_universe_summary,
    "get_fno_optionchain":       _tool_optionchain,
    "get_fno_quant_calc":        _tool_quant_calc,
    "get_fno_series_calc":       _tool_series_calc,
    "get_fno_ta_indicator":      _tool_ta_indicator,
    "get_fno_backtest":          _tool_backtest,
    "get_fno_live_quote":        _tool_live_quote,
}


def _dispatch_tool(tool_name: str, tool_input: dict[str, Any]) -> str:
    handler = _DISPATCH.get(tool_name)
    if handler is None:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})
    try:
        return json.dumps(handler(tool_input), default=str)
    except Exception as exc:
        return json.dumps({"error": f"Dispatch error: {exc}"})


def _client() -> openai.OpenAI:
    return openai.OpenAI(api_key=API_KEY, base_url=BASE_URL)


def _run_sync(question: str) -> dict[str, Any]:
    """Synchronous agentic loop — OpenAI chat/completions shape (aicredits.in proxy)."""
    client = _client()

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"Question about the F&O Tactical dashboard: {question}"},
    ]

    tool_calls_log: list[dict[str, Any]] = []
    answer = ""

    for _iteration in range(MAX_IT):
        response = client.chat.completions.create(
            model=MODEL,
            max_tokens=1024,
            messages=messages,  # type: ignore[arg-type]
            tools=TOOLS,  # type: ignore[arg-type]
            tool_choice="auto",
        )
        msg = response.choices[0].message

        assistant_entry: dict[str, Any] = {"role": "assistant", "content": msg.content}
        if msg.tool_calls:
            assistant_entry["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in msg.tool_calls
            ]
        messages.append(assistant_entry)

        if not msg.tool_calls:
            answer = msg.content or ""
            break

        for tc in msg.tool_calls:
            tool_name = tc.function.name
            try:
                tool_input = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                tool_input = {}

            result_str = _dispatch_tool(tool_name, tool_input)

            tool_calls_log.append({
                "tool": tool_name,
                "input": tool_input,
                "result_preview": result_str[:300],
            })

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result_str,
            })
    else:
        answer = (
            "I reached the maximum number of analysis steps without a final answer. "
            "Please try a more specific question."
        )

    if not answer:
        answer = (
            "I was unable to generate an answer for this question. Please try "
            "rephrasing, or ask about the breadth verdict, a specific symbol's "
            "quadrant, or its option chain."
        )

    return {"answer": answer, "queries": tool_calls_log}


async def answer_fno_question(question: str) -> dict[str, Any]:
    """Async entry point — runs the tool-use loop in a thread pool."""
    if not API_KEY:
        return {
            "answer": "AICREDIT_API_KEY is not configured. Set it in marketdna-backend/.env.",
            "queries": [],
        }
    try:
        return await asyncio.to_thread(_run_sync, question)
    except openai.AuthenticationError:
        return {
            "answer": "AICREDIT_API_KEY was rejected by aicredits.in. Check the key and AICREDIT_BASE_URL.",
            "queries": [],
        }
    except openai.APIConnectionError as exc:
        return {
            "answer": f"Could not reach the AI Desk endpoint ({BASE_URL}): {exc}",
            "queries": [],
        }
    except Exception as exc:
        log.exception("answer_fno_question failed: %s", exc)
        return {"answer": f"Error: {exc}", "queries": []}
