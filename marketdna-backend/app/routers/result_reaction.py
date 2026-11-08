"""Result Reaction routes."""
from fastapi import APIRouter

from app.models.result_reaction import ResultReactionScanResponse
from app.services import result_reaction_service

router = APIRouter(prefix="/api/result-reaction", tags=["result-reaction"])


@router.get("/scan", response_model=ResultReactionScanResponse, response_model_exclude_none=True)
def scan():
    """Price reaction around each F&O symbol's last 4 quarterly results.

    Returns instantly -- never blocks. Call repeatedly until ready=true.
    The background warmup (hits NSE's event-calendar API per symbol, throttled)
    is started automatically on server startup and re-runs at most every 7 days.
    """
    items, ready = result_reaction_service.get_cached_scan()
    progress = result_reaction_service.get_progress()
    computed = len(items) if items else progress["computed"]
    total = progress["total"] or len(items)
    return ResultReactionScanResponse(items=items, ready=ready, computed=computed, total=total)


@router.post("/scan/invalidate")
def invalidate_scan():
    """Force a fresh NSE refetch + recompute on the next warmup cycle (~2 min)."""
    result_reaction_service.invalidate_scan()
    return {"status": "scan invalidated -- recomputing in background"}
