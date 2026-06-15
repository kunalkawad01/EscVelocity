"""DataViz analytics router — histogram, vol term structure, cross-vol, risk-adj, calendar."""
from fastapi import APIRouter, Query

from app.models.dataviz_analytics import (
    CalendarResponse, CrossVolResponse, HistogramResponse,
    RiskAdjResponse, VolTermStructureResponse,
)
from app.services import dataviz_analytics_service

router = APIRouter(prefix="/api/dataviz", tags=["dataviz-analytics"])


@router.get("/histogram", response_model=HistogramResponse, response_model_exclude_none=True)
def histogram(horizon: str = Query("ret_1d")):
    return dataviz_analytics_service.get_histogram(horizon)


@router.get("/volatility/term-structure/{symbol}", response_model=VolTermStructureResponse, response_model_exclude_none=True)
def vol_term_structure(symbol: str):
    return dataviz_analytics_service.get_vol_term_structure(symbol)


@router.get("/breadth/cross-vol", response_model=CrossVolResponse, response_model_exclude_none=True)
def cross_vol():
    return dataviz_analytics_service.get_cross_vol()


@router.get("/risk-adjusted-ranking", response_model=RiskAdjResponse, response_model_exclude_none=True)
def risk_adjusted_ranking(horizon: str = Query("1m")):
    return dataviz_analytics_service.get_risk_adj_ranking(horizon)


@router.get("/calendar/{symbol}", response_model=CalendarResponse, response_model_exclude_none=True)
def calendar(symbol: str, year: int = Query(2025)):
    return dataviz_analytics_service.get_calendar(symbol, year)
