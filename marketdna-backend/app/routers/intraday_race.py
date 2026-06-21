from fastapi import APIRouter, Query
from app.models.intraday_race import IntradayReturnsResponse, NormHistoryResponse
from app.services import intraday_race_service

router = APIRouter(prefix="/api/intraday", tags=["intraday-race"])


@router.get("/returns", response_model=IntradayReturnsResponse, response_model_exclude_none=True)
def intraday_returns():
    """Current return, rank, ATR(2) and category for all symbols."""
    return intraday_race_service.get_returns()


@router.get("/norm-history", response_model=NormHistoryResponse)
def norm_history():
    """Normalized return time-series (9:15 baseline) for all symbols — one call for the line chart."""
    return intraday_race_service.get_norm_history()


@router.get("/snapshot", response_model=IntradayReturnsResponse, response_model_exclude_none=True)
def snapshot(
    time: str = Query(..., pattern=r"^\d{2}:\d{2}$", description="HH:MM IST for replay"),
):
    """Reconstruct market state at a given minute — used for post-market replay."""
    return intraday_race_service.get_snapshot(time)
