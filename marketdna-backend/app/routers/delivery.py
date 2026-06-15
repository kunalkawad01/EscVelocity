"""FastAPI router for Delivery Percentage Intelligence."""
import logging
from fastapi import APIRouter, HTTPException
from app.models.delivery import DeliveryReport, DeliverySummaryResult
from app.services import delivery_service

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/delivery", tags=["delivery"])


@router.get("/summary", response_model=DeliverySummaryResult)
def get_summary():
    """Delivery intelligence summary across all NIFTY 50 stocks."""
    return delivery_service.get_delivery_summary()


@router.get("/{symbol}", response_model=DeliveryReport)
def get_report(symbol: str):
    """Full delivery intelligence report for a single stock."""
    try:
        return delivery_service.get_delivery_report(symbol.upper())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/invalidate")
def invalidate():
    delivery_service.invalidate_cache()
    return {"status": "cache cleared"}
