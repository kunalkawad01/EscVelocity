"""FastAPI router for the Edge Decay Observatory (read-only over edge_measurements)."""
import logging

from fastapi import APIRouter, HTTPException, Query

from app.db import StoreUnavailable
from app.models.edges import (
    EdgeHistoryResponse, EdgeReportResponse, FieldHealthResponse, ObservatoryResponse,
)
from app.services import edge_observatory

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/edges", tags=["edges"])

_UNIVERSES = {"nifty200", "nifty500"}


def _norm(universe: str) -> str:
    u = (universe or "").lower().strip()
    return u if u in _UNIVERSES else "nifty500"


@router.get("/observatory", response_model=ObservatoryResponse)
def observatory(universe: str = Query("nifty500")):
    """All tracked edges: latest vitals, decay trend, status, and sparkline series.
    Statuses are derived on read from the immutable measurement record."""
    try:
        return edge_observatory.get_observatory(universe=_norm(universe))
    except StoreUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Measurement database unavailable: {exc}") from exc


@router.get("/field-health", response_model=FieldHealthResponse)
def field_health(universe: str = Query("nifty500")):
    """Rule-builder field -> underlying edge health (for builder badges). Degrades to an
    empty map when the measurement DB is unavailable — never blocks the builder."""
    return edge_observatory.get_field_health(universe=_norm(universe))


@router.get("/report", response_model=EdgeReportResponse)
def report(universe: str = Query("nifty500")):
    """The monthly 'State of the Edges' markdown report — deterministic, from the record."""
    try:
        return edge_observatory.get_report(universe=_norm(universe))
    except StoreUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Measurement database unavailable: {exc}") from exc


@router.get("/{edge_key}/history", response_model=EdgeHistoryResponse)
def history(edge_key: str, universe: str = Query("nifty500")):
    """Full monthly measurement history for one edge (the permanent record)."""
    try:
        return edge_observatory.get_history(edge_key, universe=_norm(universe))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown edge '{edge_key}'")
    except StoreUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Measurement database unavailable: {exc}") from exc


@router.post("/invalidate")
def invalidate():
    """Clear the day-cache (call after a measurement run)."""
    edge_observatory.invalidate()
    return {"status": "ok", "message": "Edge observatory cache cleared"}
