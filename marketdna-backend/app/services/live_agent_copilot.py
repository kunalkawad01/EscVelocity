"""Live Market Agent — narration + validation-gated hypotheses (read-only).

Transport: AICredits via the OpenAI SDK (same as research_copilot_service).
Toolset = live detectors (deterministic) + a subset of research tools
(event_study, ranking, screen) so any hypothesis the agent forms MUST be
validated against history before it is presented as more than a hypothesis.

READ-ONLY: there is no order-placement tool anywhere in this toolset.
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

from app.services import live_agent_service as la
from app.services.research_tools import data_version
from mcp_server.research_schemas import RESEARCH_TOOLS, dispatch_research_tool

log = logging.getLogger(__name__)

API_KEY = os.environ.get("AICREDIT_API_KEY")
BASE_URL = os.environ.get("AICREDIT_BASE_URL", "https://api.aicredits.in/v1")
MODEL = os.environ.get("RESEARCH_MODEL", os.environ.get("AICREDIT_MODEL", "claude-sonnet-5"))
MAX_IT = 16
METHODOLOGY_VERSION = "live_agent v1"

# Research tools the live agent may borrow for validation.
_BORROWED = {"event_study", "ranking", "screen"}

_LIVE_TOOLS: list[dict[str, Any]] = [
    {"type": "function", "function": {
        "name": "market_state",
        "description": "Current EOD market snapshot: breadth, regime label, % above SMAs, "
                       "advancers/decliners, new 52w highs, breakouts, momentum leaders/laggards.",
        "parameters": {"type": "object", "properties": {
            "universe": {"type": "string", "enum": ["nifty50", "nse500"], "default": "nifty50"}}, "required": []}}},
    {"type": "function", "function": {
        "name": "detect_changes",
        "description": "What changed that matters vs the last recorded snapshot: regime flips, "
                       "breadth shifts, new leadership, new-high surges. Returns only meaningful changes.",
        "parameters": {"type": "object", "properties": {
            "universe": {"type": "string", "enum": ["nifty50", "nse500"], "default": "nifty50"}}, "required": []}}},
    {"type": "function", "function": {
        "name": "opportunity_board",
        "description": "Ranked leaderboard of the strongest setups by a weighted score "
                       "(trend, relative strength, volume expansion, vol breakout, breadth).",
        "parameters": {"type": "object", "properties": {
            "universe": {"type": "string", "enum": ["nifty50", "nse500"], "default": "nifty50"},
            "top_n": {"type": "integer", "default": 15}}, "required": []}}},
    {"type": "function", "function": {
        "name": "sector_rotation",
        "description": "Sectors ranked by average 20-day return of their constituents, with the "
                       "current leading and lagging sector. Use to reason about rotation.",
        "parameters": {"type": "object", "properties": {
            "universe": {"type": "string", "enum": ["nifty50", "nse500"], "default": "nifty50"}}, "required": []}}},
    {"type": "function", "function": {
        "name": "why_move",
        "description": "EOD driver attribution for a symbol: today's move, volume, breakout, 52w-high "
                       "proximity, trend, RSI. Quantitative only — not news.",
        "parameters": {"type": "object", "properties": {
            "symbol": {"type": "string"}}, "required": ["symbol"]}}},
    {"type": "function", "function": {
        "name": "recall_events",
        "description": "Recent detected events from memory, to build a narrative over time.",
        "parameters": {"type": "object", "properties": {
            "limit": {"type": "integer", "default": 30}}, "required": []}}},
]

# Borrowed research tools (already OpenAI-shaped via converter would double-wrap;
# they are Anthropic-shaped, so convert here).
_BORROWED_TOOLS = [
    {"type": "function", "function": {"name": t["name"], "description": t["description"],
                                      "parameters": t["input_schema"]}}
    for t in RESEARCH_TOOLS if t["name"] in _BORROWED
]
TOOLS = _LIVE_TOOLS + _BORROWED_TOOLS

_LIVE_DISPATCH = {
    "market_state": lambda a: la.market_state(a.get("universe", "nifty50")),
    "sector_rotation": lambda a: la.sector_rotation(a.get("universe", "nifty50")),
    "detect_changes": lambda a: la.detect_changes(a.get("universe", "nifty50")),
    "opportunity_board": lambda a: la.opportunity_board(a.get("universe", "nifty50"), a.get("top_n", 15)),
    "why_move": lambda a: la.why_move(a["symbol"]),
    "recall_events": lambda a: la.recall_events(a.get("limit", 30)),
}

SYSTEM = """You are MarketDNA Live Agent — a read-only desk analyst for Indian equities (NSE), operating on end-of-day data.

## Your job
Answer "what is changing that matters?", not just "what happened". Observe → detect changes → narrate → (optionally) hypothesize.

## Absolute rules
1. READ-ONLY. You never place, modify, or suggest executing an order. You may describe setups and what a trader might watch, but you do not act.
2. NEVER invent a number or a signal. Detectors (market_state, detect_changes, opportunity_board, why_move) are the source of truth. State them from tool output only.
3. VALIDATION-GATED HYPOTHESES. You may form a hypothesis (e.g. "banking leadership is expanding → momentum names may continue"), but you must label it a HYPOTHESIS and, when you make a claim about what historically follows, VALIDATE it by calling event_study (or ranking/screen). If you cannot validate, say "unverified — no historical test run". Never present a hypothesis as a conclusion.
4. Alerts are for CHANGES, not every RSI cross. Use detect_changes for that.
5. Be concise and concrete. Lead with the regime/breadth read, then the change, then any validated hypothesis.

## Tools
Live detectors: market_state, sector_rotation, detect_changes, opportunity_board, why_move, recall_events.
Validation (historical): event_study, ranking, screen.

## Data source
market_state/board report a `source` field: "live" (Kite intraday overlay during market hours)
or "eod" (end-of-day fallback). Mention which when it matters.
"""


def _run_sync(question: str, universe: str) -> dict[str, Any]:
    client = openai.OpenAI(api_key=API_KEY, base_url=BASE_URL)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"Universe: {universe}\n\n{question}"},
    ]
    steps: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    answer = ""

    for _ in range(MAX_IT):
        response = client.chat.completions.create(
            model=MODEL, max_tokens=1500, messages=messages,  # type: ignore[arg-type]
            tools=TOOLS, tool_choice="auto",  # type: ignore[arg-type]
        )
        msg = response.choices[0].message
        entry: dict[str, Any] = {"role": "assistant", "content": msg.content}
        if msg.tool_calls:
            entry["tool_calls"] = [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in msg.tool_calls]
        messages.append(entry)
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
            if name in _LIVE_DISPATCH:
                result_str = json.dumps(_LIVE_DISPATCH[name](args), default=str)
            else:  # borrowed research tool
                result_str = dispatch_research_tool(name, args)
            ms = int((time.perf_counter() - t0) * 1000)
            steps.append({"tool": name, "input": args,
                          "result_hash": hashlib.sha256(result_str.encode()).hexdigest()[:16], "ms": ms})
            try:
                parsed = json.loads(result_str)
            except Exception:
                parsed = {"raw": result_str}
            artifacts.append({"tool": name, "input": args, "result": parsed})
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result_str})
    else:
        answer = "Reached the analysis step limit. Please narrow the question."

    if not answer:
        answer = "No data-backed answer. Ask about the current regime, what changed, or the opportunity board."

    manifest = {"data_version": data_version(), "methodology_version": METHODOLOGY_VERSION,
                "seed": 42, "reproducible": True, "steps": steps}
    return {"answer": answer, "manifest": manifest, "artifacts": artifacts[-8:]}


async def answer_live(question: str, universe: str = "nifty50") -> dict[str, Any]:
    if not API_KEY:
        return _err("AICREDIT_API_KEY is not configured. Set it in marketdna-backend/.env.")
    try:
        return await asyncio.to_thread(_run_sync, question, universe)
    except openai.AuthenticationError:
        return _err("AICREDIT_API_KEY was rejected by aicredits.in.")
    except openai.APIConnectionError as exc:
        return _err(f"Could not reach the AI endpoint ({BASE_URL}): {exc}")
    except Exception as exc:  # pragma: no cover
        log.exception("answer_live failed: %s", exc)
        return _err(f"Error: {exc}")


def _err(msg: str) -> dict[str, Any]:
    return {"answer": msg, "manifest": {"data_version": "", "methodology_version": METHODOLOGY_VERSION,
                                        "seed": 42, "reproducible": False, "steps": []}, "artifacts": []}
