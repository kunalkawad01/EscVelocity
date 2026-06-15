"""FastAPI router for Technical Indicator Analysis."""
import logging

from fastapi import APIRouter, HTTPException

from app.models.indicators import StockIndicators, IndicatorScanResult
from app.models.indicator_edge import IndicatorEdgeReport, StockEdgeSummaryResult
from app.services import indicators_service, indicator_edge_service

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/indicators", tags=["indicators"])


@router.get("/scan", response_model=IndicatorScanResult)
def scan_market():
    """Run indicator scan across all stocks."""
    return indicators_service.get_scan()


@router.get("/edge/summary", response_model=StockEdgeSummaryResult)
def get_edge_summary():
    """Best indicator per stock across all NIFTY symbols."""
    return indicator_edge_service.get_edge_summary()


@router.post("/invalidate")
def invalidate():
    """Clear the indicator cache."""
    indicators_service.invalidate_cache()
    return {"status": "ok", "message": "Indicator cache cleared"}


@router.get("/{symbol}/edge", response_model=IndicatorEdgeReport)
def get_edge(symbol: str):
    """Indicator Edge Lab: historical signal analysis for a stock."""
    try:
        return indicator_edge_service.get_edge_report(symbol.upper())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{symbol}", response_model=StockIndicators)
def get_symbol(symbol: str):
    """Get full indicator readings for a single stock."""
    try:
        return indicators_service.get_symbol(symbol.upper())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
