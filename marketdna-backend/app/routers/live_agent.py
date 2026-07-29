"""Live Market Agent endpoints — /api/live-agent (read-only)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.live_agent import LiveChatRequest, LiveChatResponse
from app.services import live_agent_service as la
from app.services.live_agent_copilot import answer_live

router = APIRouter(prefix="/api/live-agent", tags=["live-agent"])


@router.get("/scan")
async def scan(universe: str = "nifty50") -> dict:
    """One-shot: current state + change detection (persists snapshot) + opportunity board."""
    state = la.market_state(universe)
    if "error" in state:
        raise HTTPException(status_code=503, detail="No market data available")
    changes = la.detect_changes(universe, persist=True)
    board = la.opportunity_board(universe, top_n=15)
    return {"state": state, "changes": changes, "board": board}


@router.get("/state")
async def state(universe: str = "nifty50") -> dict:
    return la.market_state(universe)


@router.get("/board")
async def board(universe: str = "nifty50", top_n: int = 15) -> dict:
    return la.opportunity_board(universe, top_n)


@router.get("/sectors")
async def sectors(universe: str = "nifty50") -> dict:
    return la.sector_rotation(universe)


@router.get("/why/{symbol}")
async def why(symbol: str) -> dict:
    return la.why_move(symbol.upper())


@router.get("/events")
async def events(limit: int = 30) -> dict:
    return la.recall_events(limit)


@router.post("/chat", response_model=LiveChatResponse, response_model_exclude_none=True)
async def chat(body: LiveChatRequest) -> LiveChatResponse:
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    result = await answer_live(body.question, body.universe)
    return LiveChatResponse(**result)


@router.post("/invalidate")
async def invalidate() -> dict:
    la.invalidate()
    return {"status": "ok"}
