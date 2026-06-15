"""DataViz router — returns snapshot and symbol history endpoints."""
from fastapi import APIRouter, Query, HTTPException

from app.models.dataviz import ReturnSnapshotResponse, ReturnHistoryResponse, ScatterResponse, Above200WeeklyResponse
from app.services import dataviz_service

router = APIRouter(prefix="/api/dataviz", tags=["dataviz"])


@router.get("/returns/snapshot", response_model=ReturnSnapshotResponse, response_model_exclude_none=True)
def returns_snapshot(
    horizon: str = Query("ret_1d"),
    top_n: int = Query(30, ge=5, le=100),
):
    try:
        return dataviz_service.get_snapshot(horizon, top_n)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/returns/history/{symbol}", response_model=ReturnHistoryResponse, response_model_exclude_none=True)
def returns_history(
    symbol: str,
    metric: str = Query("ret_1d"),
):
    return dataviz_service.get_history(symbol, metric)


@router.get("/scatter", response_model=ScatterResponse, response_model_exclude_none=True)
def scatter(horizon: str = Query("1m")):
    return dataviz_service.get_scatter(horizon)


@router.get("/breadth/above200-weekly", response_model=Above200WeeklyResponse, response_model_exclude_none=True)
def above200_weekly():
    return dataviz_service.get_above200_weekly()
