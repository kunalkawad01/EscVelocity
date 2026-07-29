"""Research Copilot endpoints — /api/research."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.research import (
    ResearchChatRequest, ResearchChatResponse, ScreenRequest,
)
from app.services.research_copilot_service import answer_research
from app.services import research_tools as rt

router = APIRouter(prefix="/api/research", tags=["research-copilot"])


@router.post("/chat", response_model=ResearchChatResponse, response_model_exclude_none=True)
async def chat(body: ResearchChatRequest) -> ResearchChatResponse:
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    result = await answer_research(body.question, body.universe)
    return ResearchChatResponse(**result)


@router.post("/screen")
async def screen(body: ScreenRequest) -> dict:
    """Direct deterministic screen — bypasses the LLM (fast, for UI presets)."""
    if not body.criteria:
        raise HTTPException(status_code=400, detail="criteria required")
    return rt.screen(body.criteria, body.universe, body.as_of, body.sort_by, body.limit)


@router.get("/eda/{symbol}")
async def eda(symbol: str, benchmark: str = "NIFTY", lookback_days: int = 504) -> dict:
    return rt.eda_profile(symbol.upper(), benchmark, lookback_days)


@router.get("/data-version")
async def dataversion() -> dict:
    return {"data_version": rt.data_version()}


@router.post("/invalidate")
async def invalidate() -> dict:
    rt.invalidate()
    return {"status": "ok"}
