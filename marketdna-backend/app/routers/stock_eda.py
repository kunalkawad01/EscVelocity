"""Stock EDA routes — visualization-heavy exploratory analysis for a single symbol."""
from fastapi import APIRouter, HTTPException
from app.models.stock_eda import (
    VolatilitySeriesResponse, DrawdownHistoryResponse, SeasonalityResponse,
    GapsResponse, VolumeProfileResponse, AutocorrelationResponse,
    ExtremeDaysResponse, BenchmarkComparisonResponse,
)
from app.services import stock_eda_service

router = APIRouter(prefix="/api/stock-eda", tags=["stock-eda"])


@router.get("/{symbol}/volatility-series", response_model=VolatilitySeriesResponse, response_model_exclude_none=True)
def volatility_series(symbol: str):
    try:
        return stock_eda_service.get_volatility_series(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{symbol}/drawdown-history", response_model=DrawdownHistoryResponse, response_model_exclude_none=True)
def drawdown_history(symbol: str):
    try:
        return stock_eda_service.get_drawdown_history(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{symbol}/seasonality", response_model=SeasonalityResponse, response_model_exclude_none=True)
def seasonality(symbol: str):
    try:
        return stock_eda_service.get_seasonality(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{symbol}/gaps", response_model=GapsResponse, response_model_exclude_none=True)
def gaps(symbol: str):
    try:
        return stock_eda_service.get_gaps(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{symbol}/volume-profile", response_model=VolumeProfileResponse, response_model_exclude_none=True)
def volume_profile(symbol: str, bars: int = 252):
    try:
        return stock_eda_service.get_volume_profile(symbol.upper(), bars=bars)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{symbol}/autocorrelation", response_model=AutocorrelationResponse, response_model_exclude_none=True)
def autocorrelation(symbol: str):
    try:
        return stock_eda_service.get_autocorrelation(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{symbol}/extreme-days", response_model=ExtremeDaysResponse, response_model_exclude_none=True)
def extreme_days(symbol: str):
    try:
        return stock_eda_service.get_extreme_days(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{symbol}/benchmark-comparison", response_model=BenchmarkComparisonResponse, response_model_exclude_none=True)
def benchmark_comparison(symbol: str):
    try:
        return stock_eda_service.get_benchmark_comparison(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{symbol}/invalidate")
def invalidate(symbol: str):
    stock_eda_service.invalidate(symbol.upper())
    return {"status": "cache cleared"}
