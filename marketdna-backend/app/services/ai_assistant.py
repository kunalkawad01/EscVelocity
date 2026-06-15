"""Research Copilot — Anthropic SDK with MarketDNA MCP tools.

Architecture:
    User → LLM (Claude) → MCP tools → Feature Store / DuckDB
    The LLM NEVER calculates metrics — it always calls a tool.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

import anthropic

from mcp_server.server import TOOLS, dispatch_tool

log = logging.getLogger(__name__)

MODEL   = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
MAX_IT  = 12  # max tool-use iterations

SYSTEM = """You are MarketDNA Research Copilot — a quantitative analyst for Indian equities.

## Non-negotiable rules

1. NEVER calculate or estimate any metric yourself. Always call a tool first.
2. NEVER answer without data — no tool call, no answer.
3. For questions about a specific stock: call calculate_regime, calculate_stock_dna, or
   calculate_drawdown first, then explain the result in plain English.
4. For market-wide questions: call calculate_breadth or calculate_market_dna first.
5. If a tool returns {"status": "roadmap"}, tell the user it is on the product roadmap
   and explain what it will do when built.
6. Be concise: 3–6 sentences unless more detail is explicitly requested.
7. Always mention the score, label, and one key insight from the tool result.
8. Regime interpretation: Strong Bull (80-100) → trend intact, all SMAs aligned;
   Neutral (40-59) → choppy, avoid new entries; Strong Bear (0-19) → trend broken.
9. Breadth interpretation: <40 means even bullish signals have low reliability.

## Available tools (call these — never compute manually)

- calculate_regime(symbol) → Regime Score 0-100 + components
- calculate_breadth() → Market Breadth Score 0-100
- calculate_drawdown(symbol) → current & max drawdown %
- calculate_recovery(symbol) → Recovery Score 0-100
- calculate_relative_strength(symbol) → RS Score 0-100 vs NIFTY 50
- calculate_stock_dna(symbol) → composite DNA Score 0-100
- calculate_market_dna() → overall market health score
- query_raw_data(sql) → DuckDB query on equities_prices (fallback only)
- run_backtest / validate_metric / construct_portfolio / analyze_options_strategy
  / run_macro_analysis → roadmap stubs, return status information

## Database (for query_raw_data only — use only when no other tool fits)

View: equities_prices | Columns: date DATE, open, high, low, close DOUBLE, volume BIGINT, symbol TEXT
DuckDB rules: strftime(date, '%Y-%m') for monthly, date >= '2020-01-01' for date filter.
"""


def _run_sync(symbol: str, question: str) -> dict[str, Any]:
    """Synchronous agentic loop — wraps Anthropic tool-use cycle."""
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    messages: list[dict[str, Any]] = [
        {"role": "user", "content": f"Stock in focus: {symbol}\n\nQuestion: {question}"},
    ]

    tool_calls_log: list[dict[str, Any]] = []
    answer = ""

    for iteration in range(MAX_IT):
        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=SYSTEM,
            tools=TOOLS,  # type: ignore[arg-type]
            messages=messages,
        )

        # Append assistant turn
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            # Extract text from last assistant message
            for block in response.content:
                if hasattr(block, "text"):
                    answer = block.text
            break

        if response.stop_reason == "tool_use":
            tool_results: list[dict[str, Any]] = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                tool_name  = block.name
                tool_input = block.input
                result_str = dispatch_tool(tool_name, tool_input)

                tool_calls_log.append({
                    "tool": tool_name,
                    "input": tool_input,
                    "result_preview": result_str[:300],
                })

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_str,
                })

            messages.append({"role": "user", "content": tool_results})
        else:
            # Unexpected stop reason — extract whatever text is available
            for block in response.content:
                if hasattr(block, "text"):
                    answer = block.text
            break
    else:
        answer = (
            "I reached the maximum number of analysis steps without a final answer. "
            "Please try a more specific question."
        )

    if not answer:
        answer = (
            "I was unable to generate an answer for this question. "
            "Please try rephrasing or ask about a specific metric like Regime Score, "
            "Drawdown, or Relative Strength."
        )

    return {"answer": answer, "queries": tool_calls_log}


async def answer_question(symbol: str, question: str) -> dict[str, Any]:
    """Async entry point — runs the Claude agentic loop in a thread pool."""
    try:
        return await asyncio.to_thread(_run_sync, symbol, question)
    except anthropic.AuthenticationError:
        return {
            "answer": "ANTHROPIC_API_KEY is missing or invalid. Set it in the .env file.",
            "queries": [],
        }
    except Exception as exc:
        log.exception("answer_question failed: %s", exc)
        return {"answer": f"Error: {exc}", "queries": []}
