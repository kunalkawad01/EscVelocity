"""Sector Heatmap API endpoints."""
import logging

from fastapi import APIRouter, HTTPException, Query

from app.models.heatmap import SectorHeatmapResponse
from app.services import sector_heatmap_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sector-heatmap", tags=["sector-heatmap"])

_VALID_UNIVERSES = {"nifty50", "nifty200", "nifty500", "fno"}


@router.get("", response_model=SectorHeatmapResponse)
def get_sector_heatmap(
    universe: str = Query("nifty500", description="nifty50 | nifty200 | nifty500 | fno"),
):
    """Return per-sector, per-stock returns across 7 timeframes."""
    if universe not in _VALID_UNIVERSES:
        raise HTTPException(400, f"Invalid universe. Choose from: {sorted(_VALID_UNIVERSES)}")
    try:
        return sector_heatmap_service.get_heatmap(universe)
    except Exception as exc:
        log.exception("sector-heatmap error for universe=%s", universe)
        raise HTTPException(500, str(exc))


@router.post("/invalidate")
def invalidate_heatmap(
    universe: str | None = Query(None, description="Leave empty to invalidate all universes"),
):
    """Flush the in-process cache so the next request recomputes fresh data."""
    sector_heatmap_service.invalidate(universe)
    return {"status": "ok", "invalidated": universe or "all"}
