"""FastAPI router for Stock Drivers — curated fundamental context per symbol.

Read-only over the YAML content store loaded by ``drivers_service``.
Route order matters: ``/coverage`` must be declared before ``/{symbol}``.
"""

import logging

from fastapi import APIRouter, HTTPException

from app.models.drivers import DriversCoverage, StockDrivers
from app.services import drivers_service

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/drivers", tags=["drivers"])


@router.get("/coverage", response_model=DriversCoverage)
def coverage():
    """Symbols that have a driver dossier (frontend shows/hides the section)."""
    return drivers_service.get_coverage()


@router.get("/{symbol}", response_model=StockDrivers, response_model_exclude_none=True)
def drivers(symbol: str):
    """Full driver dossier for one symbol: narrative, plain-English, forecast layers,
    plus resolved live metrics for drivers with a `live` wiring (step 6)."""
    dossier = drivers_service.get_drivers_enriched(symbol)
    if dossier is None:
        raise HTTPException(
            status_code=404,
            detail=f"No driver dossier for '{symbol.upper()}' yet",
        )
    return dossier


@router.post("/invalidate", response_model=DriversCoverage)
def invalidate():
    """Re-read dossier YAML files from disk (after content edits, no restart needed)."""
    result = drivers_service.invalidate()
    log.info("drivers: reloaded %d dossiers via invalidate", result.count)
    return result
