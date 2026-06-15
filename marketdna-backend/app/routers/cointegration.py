"""FastAPI router for Cointegration Pairs module."""
import logging
from fastapi import APIRouter, HTTPException
from app.models.cointegration import CointegrationScanResult
from app.services import cointegration_service

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/cointegration", tags=["cointegration"])


@router.get("/scan", response_model=CointegrationScanResult)
def get_scan():
    """Cointegrated pairs scan across all NIFTY 50 stocks."""
    try:
        return cointegration_service.get_cointegration_scan()
    except Exception as exc:
        log.error("cointegration scan failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/invalidate")
def invalidate():
    """Clear the cointegration cache."""
    cointegration_service.invalidate_cache()
    return {"status": "cache cleared"}
