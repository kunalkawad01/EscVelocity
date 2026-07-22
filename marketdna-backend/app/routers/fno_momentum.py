"""F&O Momentum Radar router (/api/fno-momentum).

Bifurcated futures-positioning lists (OI Gainers · Short Covering) filtered by
momentum qualifiers (±5% prev session · top-3 sectors · ±2% at 9:15). Live via
Kite during market hours, DuckDB EOD fallback otherwise — same substrate as
/api/fno. Frontend polls /scan every 5s while state == LIVE.
"""
import logging
from fastapi import APIRouter

from app.services import fno_momentum_service as svc
from app.models.fno_momentum import FnoMomentumResponse

router = APIRouter(prefix="/api/fno-momentum", tags=["fno-momentum"])
log = logging.getLogger(__name__)


@router.get("/scan", response_model=FnoMomentumResponse, response_model_exclude_none=True)
def get_scan():
    """OI Gainers + Short Covering lists with per-row qualifying criteria."""
    return svc.get_scan()


@router.post("/invalidate")
def invalidate():
    """Flush underlying tactical/live caches (run after post-market ingestion)."""
    svc.invalidate()
    return {"status": "invalidated"}
