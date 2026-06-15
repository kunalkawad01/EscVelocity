"""DataViz breadth/factor extra router — multi-SMA, advance-decline, correlation, alpha-beta."""
from fastapi import APIRouter, Query

from app.models.dataviz_breadth_extra import (
    ADResponse, AlphaBetaResponse, CorrMatrixResponse, MultiSMAResponse,
)
from app.services import dataviz_breadth_extra_service

router = APIRouter(prefix="/api/dataviz", tags=["dataviz-breadth"])


@router.get("/breadth/multi-sma", response_model=MultiSMAResponse, response_model_exclude_none=True)
def multi_sma():
    return dataviz_breadth_extra_service.get_multi_sma()


@router.get("/breadth/advance-decline", response_model=ADResponse, response_model_exclude_none=True)
def advance_decline():
    return dataviz_breadth_extra_service.get_advance_decline()


@router.get("/correlation/matrix", response_model=CorrMatrixResponse, response_model_exclude_none=True)
def correlation_matrix(
    horizon: str = Query("ret_1d"),
    lookback: int = Query(252),
):
    return dataviz_breadth_extra_service.get_correlation_matrix(horizon, lookback)


@router.get("/factor/alpha-beta", response_model=AlphaBetaResponse, response_model_exclude_none=True)
def alpha_beta(
    horizon: str = Query("ret_1d"),
    lookback: int = Query(252),
):
    return dataviz_breadth_extra_service.get_alpha_beta(horizon, lookback)
