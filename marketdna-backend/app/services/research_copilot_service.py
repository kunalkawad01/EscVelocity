"""Research Copilot — agentic loop over the deterministic quant toolset.

Transport: aicredits.in is an OpenAI-compatible proxy (chat/completions,
`choices`/`tool_calls`), NOT Anthropic's native Messages API — same as
fno_assistant.py. This module uses the `openai` SDK pointed at AICREDIT_BASE_URL
with OpenAI-shaped function tools. Model defaults to claude-sonnet-5.

The planner selects research_tools; the model never computes a number itself.
Every response ships a computation manifest (RESEARCH_COPILOT_SPEC.md §6).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from typing import Any

import openai

from mcp_server.research_schemas import to_openai_tools, dispatch_research_tool
from app.services.research_tools import data_version

log = logging.getLogger(__name__)

# AICredits credentials (shared with the F&O AI Desk). RESEARCH_MODEL lets the
# copilot pin a stronger planner model independently of the F&O desk.
API_KEY = os.environ.get("AICREDIT_API_KEY")
BASE_URL = os.environ.get("AICREDIT_BASE_URL", "https://api.aicredits.in/v1")
MODEL = os.environ.get("RESEARCH_MODEL", os.environ.get("AICREDIT_MODEL", "claude-sonnet-5"))

TOOLS = to_openai_tools()
MAX_IT = 20
METHODOLOGY_VERSION = "research_copilot v1"

SYSTEM = """You are MarketDNA Research Copilot — a quantitative research analyst for Indian equities (NSE).

## Absolute rules
1. NEVER calculate, estimate, or invent any number (indicator, return, probability, ratio). ALWAYS call a tool. No tool call → no numeric claim.
2. Pick the smallest set of tools that answers the question. Common patterns:
   - "stocks below X RSI" / any filter → screen
   - single-stock indicator value → compute_indicators
   - returns / volatility / correlation / distribution / drawdown → compute_stats
   - "characterize / profile this stock" → eda_profile
   - raw OHLCV rows → query_data
   - "backtest / test this strategy / how would X have done" → backtest
   - "what happens after / historically after <event>" → event_study
   - "strongest / rank / top momentum (or RS, low-vol) stocks" → ranking
   - "optimize / best parameters / tune" → optimize (use $placeholders + grid)
   - "is it robust / walk-forward / out-of-sample / does it still work" → walk_forward
   - "how robust / monte carlo / distribution of outcomes" → monte_carlo (needs a
     backtest handle: run backtest first, pass its `handle` as backtest_ref)
   - genuinely custom analysis no tool above covers → run_python (LAST RESORT).
     Assign the answer to `result`; you get `df`, `con`, np, pd, scipy, talib, vbt.
     Never reach for run_python when screen/backtest/event_study/compute_stats can answer.
2b. For backtest, express the strategy as entry/exit rule lists using the field grammar
   (e.g. EMA20/50 crossover → entry [{field:"ema_20",op:">",value:"ema_50"}], exit
   [{field:"ema_20",op:"<",value:"ema_50"}], stop {type:"atr",mult:2}). Report CAGR,
   Sharpe, max drawdown, win rate; ALWAYS note in-sample results overstate live edge.
2c. For event_study, choose direction:'bearish' when the event predicts a fall (e.g.
   RSI cross below 70) so positive numbers mean the setup worked. Always report the
   sample size (n) and flag if it is small.
3. For screen, translate the request into {field, op, value} criteria. Field forms:
   rsi_14, sma_50, ema_20, atr_14, ret_20 (20-day % return), vol_20 (annualized %),
   volume_ratio_20, atr_percentile_252, above_sma_200, dist_52w_high, dist_52w_low.
   Comparisons between fields: set value to the other field name (e.g. ema_20 > ema_50 → {field:"ema_20", op:">", value:"ema_50"}).
4. After tools return, explain the result in plain English: what the numbers mean, sample size, and any caveat (e.g. proxy benchmark, small n). Be concise — 3–6 sentences plus a short list of the key matches when relevant.
5. State units. RSI is 0–100; returns/vol are in %.
6. If a tool returns an error or empty match, say so plainly and suggest a refined query. Do not fabricate results.

## Data
Universe: NSE 500 (default) or NIFTY 50, ~6 years daily OHLCV. Benchmark for correlation is an equal-weighted market proxy unless a real symbol is given — mention this when used.
"""


def _client() -> openai.OpenAI:
    return openai.OpenAI(api_key=API_KEY, base_url=BASE_URL)


def _run_sync(question: str, universe: str) -> dict[str, Any]:
    client = _client()
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"Default universe: {universe}\n\nQuestion: {question}"},
    ]
    steps: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    answer = ""

    for _ in range(MAX_IT):
        response = client.chat.completions.create(
            model=MODEL,
            max_tokens=1500,
            messages=messages,  # type: ignore[arg-type]
            tools=TOOLS,  # type: ignore[arg-type]
            tool_choice="auto",
        )
        msg = response.choices[0].message

        assistant_entry: dict[str, Any] = {"role": "assistant", "content": msg.content}
        if msg.tool_calls:
            assistant_entry["tool_calls"] = [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in msg.tool_calls
            ]
        messages.append(assistant_entry)

        if not msg.tool_calls:
            answer = msg.content or ""
            break

        for tc in msg.tool_calls:
            name = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            t0 = time.perf_counter()
            result_str = dispatch_research_tool(name, args)
            ms = int((time.perf_counter() - t0) * 1000)
            steps.append({
                "tool": name, "input": args,
                "result_hash": hashlib.sha256(result_str.encode()).hexdigest()[:16],
                "ms": ms,
            })
            try:
                parsed = json.loads(result_str)
            except Exception:
                parsed = {"raw": result_str}
            artifacts.append({"tool": name, "input": args, "result": parsed})
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result_str})
    else:
        answer = "Reached the maximum number of analysis steps. Please narrow the question."

    if not answer:
        answer = ("I could not produce a data-backed answer. Try a more specific "
                  "query, e.g. 'stocks with RSI below 20'.")

    manifest = {
        "data_version": data_version(),
        "methodology_version": METHODOLOGY_VERSION,
        "seed": 42,
        "reproducible": True,
        "steps": steps,
    }
    return {"answer": answer, "manifest": manifest, "artifacts": artifacts[-8:]}


async def answer_research(question: str, universe: str = "nse500") -> dict[str, Any]:
    if not API_KEY:
        return _err("AICREDIT_API_KEY is not configured. Set it in marketdna-backend/.env.")
    try:
        return await asyncio.to_thread(_run_sync, question, universe)
    except openai.AuthenticationError:
        return _err("AICREDIT_API_KEY was rejected by aicredits.in. Check the key and AICREDIT_BASE_URL.")
    except openai.APIConnectionError as exc:
        return _err(f"Could not reach the AI endpoint ({BASE_URL}): {exc}")
    except Exception as exc:  # pragma: no cover
        log.exception("answer_research failed: %s", exc)
        return _err(f"Error: {exc}")


def _err(msg: str) -> dict[str, Any]:
    return {
        "answer": msg,
        "manifest": {"data_version": "", "methodology_version": METHODOLOGY_VERSION,
                     "seed": 42, "reproducible": False, "steps": []},
        "artifacts": [],
    }
