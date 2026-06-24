from fastapi import APIRouter, HTTPException
from app.models.live_trading import (
    SectorScatterResponse,
    SectorDrillDownResponse,
    StockIntelligenceResponse,
    BreakthroughSignalsResponse,
    StockChartResponse,
    StockIntradayResponse,
    StockOptionsResponse,
    StrikeChartResponse,
    SectorProgressionsResponse,
    LiveBreadthResponse,
)
from app.services import live_trading_service

router = APIRouter(prefix="/api/live", tags=["live-trading"])


@router.get("/sectors", response_model=SectorScatterResponse, response_model_exclude_none=True)
def sector_scatter():
    """Layer 1 — Sector scatter: Return vs ATR for all sectors."""
    return live_trading_service.get_sector_scatter()


@router.get("/sector-progressions", response_model=SectorProgressionsResponse, response_model_exclude_none=True)
def sector_progressions():
    """Layer 1 supplementary — All-sector return progression (live 5s ticks or 15-min Kite history)."""
    return live_trading_service.get_sector_progressions()


@router.get("/sector/{sector_name}", response_model=SectorDrillDownResponse, response_model_exclude_none=True)
def sector_detail(sector_name: str):
    """Layer 2 — 4-panel sector drill-down."""
    result = live_trading_service.get_sector_detail(sector_name)
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
def breakthrough_signals():
    """Layer 4 — Breakthrough intelligence: live long/short signals with Why Now cards."""
    return live_trading_service.get_breakthrough_signals()


@router.get("/stock/{symbol}/strike-chart", response_model=StrikeChartResponse, response_model_exclude_none=True)
def strike_chart(symbol: str, strike: float, expiry: str):
    """Today's 1-min price + OI for futures / CE / PE at the given strike."""
    result = live_trading_service.get_strike_chart(symbol.upper(), strike, expiry)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No data for {symbol} strike {strike}")
    return result


@router.get("/stock/{symbol}/options", response_model=StockOptionsResponse, response_model_exclude_none=True)
def stock_options(symbol: str):
    """Live option chain — ATM ± 3 strikes, nearest expiry. F&O stocks only."""
    return live_trading_service.get_stock_options(symbol.upper())


@router.get("/stock/{symbol}/intraday", response_model=StockIntradayResponse, response_model_exclude_none=True)
def stock_intraday(symbol: str):
    """Today's intraday tick series for the stock session drawer."""
    result = live_trading_service.get_stock_intraday(symbol.upper())
    if result is None:
        raise HTTPException(status_code=404, detail=f"No intraday data for '{symbol}'")
    return result


@router.get("/stock/{symbol}/chart", response_model=StockChartResponse, response_model_exclude_none=True)
def stock_chart(symbol: str):
    """Layer 3 supplementary — OHLCV chart data + SMA + drawdown + multi-TF universe/sector ranks."""
    result = live_trading_service.get_stock_chart(symbol.upper())
    if result is None:
        raise HTTPException(status_code=404, detail=f"No data for '{symbol}'")
    return result


@router.get("/breadth", response_model=LiveBreadthResponse, response_model_exclude_none=True)
def live_breadth():
    """Advances / declines / unchanged across tracked universe at current prices."""
    return live_trading_service.get_live_breadth()
