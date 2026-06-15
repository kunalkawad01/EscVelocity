"""Short Intelligence routes."""
from fastapi import APIRouter
from app.models.short import ShortIntelligenceResult
from app.services import short_service

router = APIRouter(prefix="/api/short", tags=["short"])


@router.get("/intelligence", response_model=ShortIntelligenceResult)
def get_intelligence():
    """Short opportunities and squeeze watch across NIFTY 50."""
    return short_service.get_short_intelligence()


@router.post("/invalidate")
def invalidate():
    short_service.invalidate_cache()
    return {"status": "cache cleared"}
