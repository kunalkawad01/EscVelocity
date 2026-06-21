from fastapi import APIRouter, HTTPException, Query
from app.models.live_trading import (
    SectorScatterResponse,
    SectorDrillDownResponse,
    StockIntelligenceResponse,
    BreakthroughSignalsResponse,
    StockChartResponse,
    SectorProgressionsResponse,
)
from app.services import live_trading_service

router = APIRouter(prefix="/api/live", tags=["live-trading"])


@router.get("/sectors", response_model=SectorScatterResponse, response_model_exclude_none=True)
def sector_scatter(universe: str = Query("nifty500", pattern="^(nifty500|nifty200)$")):
    """Layer 1 — Sector scatter: Return vs ATR for all sectors."""
    return live_trading_service.get_sector_scatter(universe)


@router.get("/sector-progressions", response_model=SectorProgressionsResponse, response_model_exclude_none=True)
def sector_progressions(universe: str = Query("nifty500", pattern="^(nifty500|nifty200)$")):
    """Layer 1 supplementary — All-sector return progression (live 5s ticks or 15-min Kite history)."""
    return live_trading_service.get_sector_progressions(universe)


@router.get("/sector/{sector_name}", response_model=SectorDrillDownResponse, response_model_exclude_none=True)
def sector_detail(sector_name: str, universe: str = Query("nifty500", pattern="^(nifty500|nifty200)$")):
    """Layer 2 — 4-panel sector drill-down."""
    result = live_trading_service.get_sector_detail(sector_name, universe)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Sector '{sector_name}' not found")
    return result


@router.get("/stock/{symbol}", response_model=StockIntelligenceResponse, response_model_exclude_none=True)
def stock_intelligence(symbol: str):
    """Layer 3 — Stock intelligence card with directional bias."""
    result = live_trading_service.get_stock_intelligence(symbol.upper())
    if result is None:
        raise HTTPException(status_code=404, detail=f"No data for '{symbol}'")
    return result


@router.get("/signals", response_model=BreakthroughSignalsResponse, response_model_exclude_none=True)
def breakthrough_signals(universe: str = Query("nifty500", pattern="^(nifty500|nifty200)$")):
    """Layer 4 — Breakthrough intelligence: live long/short signals with Why Now cards."""
    return live_trading_service.get_breakthrough_signals(universe)


@router.get("/stock/{symbol}/chart", response_model=StockChartResponse, response_model_exclude_none=True)
def stock_chart(symbol: str):
    """Layer 3 supplementary — OHLCV chart data + SMA + drawdown + multi-TF universe/sector ranks."""
    result = live_trading_service.get_stock_chart(symbol.upper())
    if result is None:
        raise HTTPException(status_code=404, detail=f"No data for '{symbol}'")
    return result
