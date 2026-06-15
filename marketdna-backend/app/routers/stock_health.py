"""Stock Health routes."""
from fastapi import APIRouter, HTTPException
from app.models.stock_health import StockHealthReport, ArchetypeScanResponse
from app.services import stock_health_service
router = APIRouter(prefix="/api/stock-health", tags=["stock-health"])


@router.get("/scan", response_model=ArchetypeScanResponse)
def archetype_scan():
    """Return archetype summaries for all cached symbols + readiness flag.

    Returns instantly — no blocking. Call repeatedly until ready=true.
    The background warmup is started automatically on server startup.
    """
    from app.services.stock_metrics import get_universe
    items, ready = stock_health_service.get_cached_scan()
    return ArchetypeScanResponse(
        items=items, ready=ready,
        computed=len(items),
        total=len(get_universe()),
    )


@router.post("/scan/invalidate")
def invalidate_scan():
    """Force a fresh batch recompute on the next warmup cycle.

    Call this after end-of-day data ingestion to refresh all 500 stock
    profiles. The next poll to /scan will show ready=false while the
    batch runs (~60-90 s), then ready=true with updated data.
    """
    stock_health_service.invalidate_scan()
    return {"status": "scan invalidated — recomputing in background"}


@router.get("/{symbol}", response_model=StockHealthReport)
def get_report(symbol: str):
    """20-metric behavioral profile of a stock's return quality."""
    try:
        return stock_health_service.get_report(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{symbol}/invalidate")
def invalidate(symbol: str):
    stock_health_service.invalidate(symbol.upper())
    return {"status": "cache cleared"}
