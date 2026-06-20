from fastapi import APIRouter
from app.models.breakout import BreakoutScanResponse
from app.services import breakout_service

router = APIRouter(prefix="/api/breakout", tags=["breakout"])


@router.get("/scan", response_model=BreakoutScanResponse, response_model_exclude_none=True)
async def scan():
    return breakout_service.get_scan()
