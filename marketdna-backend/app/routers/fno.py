"""F&O Live Tactical Dashboard router (/api/fno).

Zones: 0 breadth gate · 1 OI positioning scatter · 2 normalized 9:15 lines ·
3 option-chain drilldown. All data is live (Kite) during market hours, DuckDB
EOD-settled otherwise. Frontend polls /state + /universe + /breadth + /normalized
every 5s; the option-chain endpoints are hit only while a panel is open.
"""
import logging
from fastapi import APIRouter, HTTPException, Query

from app.services import fno_tactical_service as svc
from app.services.fno_assistant import answer_fno_question
from app.models.fno import (
    MarketState, FnoUniverseResponse, BreadthVerdict, NormalizedSeries,
    OptionChainResponse, StrikeChartResponse, FnoChatRequest, FnoChatResponse,
)

router = APIRouter(prefix="/api/fno", tags=["fno-tactical"])
log = logging.getLogger(__name__)


@router.get("/state", response_model=MarketState)
def get_state():
    """Market-state gate: PRE_PRECOMPUTE | PRE_OPEN | LIVE | CLOSED | HOLIDAY."""
    return svc.get_state()


@router.get("/universe", response_model=FnoUniverseResponse, response_model_exclude_none=True)
def get_universe():
    """Zone 1 — per-symbol positioning rows (scatter) + embedded signal grade."""
    return svc.get_universe()


@router.get("/breadth", response_model=BreadthVerdict, response_model_exclude_none=True)
def get_breadth():
    """Zone 0 — market-wide breadth verdict (should-I-trade-at-all gate)."""
    return svc.get_breadth()


@router.get("/normalized", response_model=NormalizedSeries, response_model_exclude_none=True)
def get_normalized(symbols: str | None = Query(None, description="CSV of symbols to plot")):
    """Zone 2 — rebased-to-9:15 relative-strength lines + NIFTY proxy + sector."""
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()] if symbols else None
    return svc.get_normalized(syms)


@router.get("/optionchain/{symbol}", response_model=OptionChainResponse, response_model_exclude_none=True)
def get_optionchain(symbol: str):
    """Zone 3 — ATM±3 strike ladder + front future for the clicked symbol."""
    result = svc.get_optionchain(symbol.upper())
    if result is None:
        raise HTTPException(status_code=404, detail=f"No option chain for {symbol}")
    return result


@router.get("/optionchain/{symbol}/strike-chart", response_model=StrikeChartResponse, response_model_exclude_none=True)
def get_strike_chart(
    symbol: str,
    strike: float = Query(..., description="Strike price"),
    expiry: str = Query(..., description="Expiry YYYY-MM-DD"),
):
    """Zone 3 — FUT/CE/PE intraday price + OI series for one strike (dual-axis charts)."""
    return svc.get_strike_chart(symbol.upper(), strike, expiry)


@router.post("/invalidate")
def invalidate():
    """Flush scan + futures-meta caches (run after post-market ingestion)."""
    svc.invalidate()
    return {"status": "invalidated"}


@router.post("/chat", response_model=FnoChatResponse)
async def chat(body: FnoChatRequest):
    """AI Desk — tool-use Q&A over live F&O data (breadth, universe, option chain)."""
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    result = await answer_fno_question(body.question)
    return FnoChatResponse(**result)
