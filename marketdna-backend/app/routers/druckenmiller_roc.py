"""Druckenmiller ROC² API endpoints."""
import logging

from fastapi import APIRouter, HTTPException

from app.models.druckenmiller_roc import ROC2StockResult, ROC2ScanResult
from app.services import druckenmiller_roc_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/roc2", tags=["druckenmiller-roc2"])


@router.get("/scan", response_model=ROC2ScanResult)
def get_scan():
    """Full universe ROC² scan — phase classification + composite score per symbol."""
    try:
        return druckenmiller_roc_service.get_scan()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        log.exception("roc2 scan error")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{symbol}", response_model=ROC2StockResult)
def get_stock(symbol: str):
    """ROC² signal for a single symbol — three timeframes + phase + history."""
    try:
        return druckenmiller_roc_service.get_stock_signal(symbol.upper())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        log.exception("roc2 error for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/invalidate")
def invalidate():
    druckenmiller_roc_service.invalidate_cache()
    return {"status": "cache cleared"}
