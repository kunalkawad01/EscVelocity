"""MarketDNA MCP Server — Anthropic tool schemas and dispatch.

Usage:
    from mcp_server.server import TOOLS, dispatch_tool

    # Pass TOOLS to anthropic.messages.create(tools=TOOLS, ...)
    # When Claude returns a tool_use block:
    result = dispatch_tool(tool_name, tool_input)
"""
from __future__ import annotations

import json
from typing import Any

from mcp_server import tool_handlers as h

# ─── Anthropic tool schema definitions ────────────────────────────────────────

TOOLS: list[dict[str, Any]] = [
    {
        "name": "calculate_regime",
        "description": (
            "Compute the Regime Score (0–100) for a single NIFTY 50 stock. "
            "Measures structural trend quality via price position vs SMAs, "
            "SMA alignment (bull stack), and SMA slope. "
            "Labels: Strong Bull (80-100), Moderate Bull (60-79), Neutral (40-59), "
            "Moderate Bear (20-39), Strong Bear (0-19)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "NSE ticker symbol (e.g. 'RELIANCE', 'TCS', 'HDFCBANK')",
                },
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "calculate_breadth",
        "description": (
            "Compute Market Breadth Score (0–100) across all NIFTY 50 stocks. "
            "Formula: pct_above_sma20×0.30 + pct_above_sma50×0.40 + pct_above_sma200×0.30. "
            "Shows how broadly the market is participating. "
            "Note: breadth <40 means bullish signals have lower reliability."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "calculate_drawdown",
        "description": (
            "Compute current drawdown and maximum drawdown for a stock "
            "over a lookback window. Returns the date of maximum drawdown "
            "and how far the stock has fallen from its peak."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "NSE ticker symbol",
                },
                "lookback_days": {
                    "type": "integer",
                    "description": "Number of trading days to look back (default 252 = ~1 year)",
                    "default": 252,
                },
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "calculate_recovery",
        "description": (
            "Compute Recovery Score (0–100) for a stock: how much of the "
            "maximum drawdown has been recovered. 100 = fully recovered, "
            "0 = still at the trough."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "NSE ticker symbol"},
                "lookback_days": {
                    "type": "integer",
                    "description": "Lookback window in trading days (default 252)",
                    "default": 252,
                },
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "calculate_relative_strength",
        "description": (
            "Compute Relative Strength Score (0–100) for a stock based on "
            "its 20-day return ranked against all 48 NIFTY 50 symbols. "
            "100 = highest performer, 0 = lowest."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "NSE ticker symbol"},
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "calculate_stock_dna",
        "description": (
            "Compute Stock DNA Score (0–100): a composite score combining "
            "regime (35%), recovery (25%), relative strength (25%), "
            "and efficiency ratio (15%), minus a drawdown penalty. "
            "Labels: Elite (80+), Strong (65-79), Moderate (45-64), Weak (25-44), Distressed (<25)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "NSE ticker symbol"},
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "calculate_market_dna",
        "description": (
            "Compute Market DNA Score (0–100): overall market health combining "
            "breadth (35%), average regime (30%), leadership (20%), and "
            "inverse stress (15%). "
            "Labels: Healthy Bull (70+), Moderate Bull (55-69), Neutral (40-54), "
            "Moderate Bear (25-39), Stressed Market (<25)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "query_raw_data",
        "description": (
            "Execute a DuckDB SQL query against the equities_prices view. "
            "Use this ONLY when no other tool covers the needed analysis. "
            "View schema: date DATE, open DOUBLE, high DOUBLE, low DOUBLE, "
            "close DOUBLE, volume BIGINT, symbol TEXT. "
            "Always filter by symbol. Use strftime(date, '%Y-%m') for monthly grouping."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sql": {
                    "type": "string",
                    "description": "DuckDB SQL query. Must reference equities_prices.",
                },
            },
            "required": ["sql"],
        },
    },
    {
        "name": "run_backtest",
        "description": "Run a strategy backtest using VectorBT. Currently on the roadmap (Phase 3).",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "strategy": {"type": "string"},
                "params": {"type": "object"},
            },
            "required": ["symbol", "strategy"],
        },
    },
    {
        "name": "validate_metric",
        "description": "Run decile and forward-return validation for a feature. Roadmap Phase 3.",
        "input_schema": {
            "type": "object",
            "properties": {
                "metric": {"type": "string"},
                "symbol": {"type": "string"},
            },
            "required": ["metric", "symbol"],
        },
    },
    {
        "name": "construct_portfolio",
        "description": "Construct a portfolio from a list of symbols with optional weights. Roadmap Phase 6.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbols": {"type": "array", "items": {"type": "string"}},
                "weights": {"type": "object"},
            },
            "required": ["symbols"],
        },
    },
    {
        "name": "analyze_options_strategy",
        "description": "Analyze an options strategy for a symbol. Roadmap Phase 7.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "strategy": {"type": "string"},
            },
            "required": ["symbol", "strategy"],
        },
    },
    {
        "name": "run_macro_analysis",
        "description": "Run macro research on a given topic or sector. Roadmap Phase 8.",
        "input_schema": {
            "type": "object",
            "properties": {
                "topic": {"type": "string"},
            },
            "required": ["topic"],
        },
    },
]

# ─── Dispatch ──────────────────────────────────────────────────────────────────

_DISPATCH: dict[str, Any] = {
    "calculate_regime":           lambda args: h.calculate_regime(args["symbol"]),
    "calculate_breadth":          lambda args: h.calculate_breadth(),
    "calculate_drawdown":         lambda args: h.calculate_drawdown(
                                      args["symbol"], args.get("lookback_days", 252)),
    "calculate_recovery":         lambda args: h.calculate_recovery(
                                      args["symbol"], args.get("lookback_days", 252)),
    "calculate_relative_strength":lambda args: h.calculate_relative_strength(args["symbol"]),
    "calculate_stock_dna":        lambda args: h.calculate_stock_dna(args["symbol"]),
    "calculate_market_dna":       lambda args: h.calculate_market_dna(),
    "query_raw_data":             lambda args: h.query_raw_data(args["sql"]),
    "run_backtest":               lambda args: h.run_backtest(
                                      args["symbol"], args["strategy"],
                                      args.get("params")),
    "validate_metric":            lambda args: h.validate_metric(
                                      args["metric"], args["symbol"]),
    "construct_portfolio":        lambda args: h.construct_portfolio(
                                      args["symbols"], args.get("weights")),
    "analyze_options_strategy":   lambda args: h.analyze_options_strategy(
                                      args["symbol"], args["strategy"]),
    "run_macro_analysis":         lambda args: h.run_macro_analysis(args["topic"]),
}


def dispatch_tool(tool_name: str, tool_input: dict[str, Any]) -> str:
    """Call the handler for tool_name and return a JSON string result."""
    handler = _DISPATCH.get(tool_name)
    if handler is None:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})
    try:
        result = handler(tool_input)
        return json.dumps(result, default=str)
    except Exception as exc:
        return json.dumps({"error": f"Dispatch error: {exc}"})


class MCPServer:
    """Convenience wrapper — useful for import verification and future extensions."""

    tools = TOOLS
    dispatch = staticmethod(dispatch_tool)
