from fastapi import APIRouter, HTTPException
from app.services import stock_metrics, stock_metrics_advanced
from app.models.stock import (
    OHLCVResponse, RelativeStrengthResponse, ReturnsResponse,
    RiskResponse, DrawdownResponse, MarketComparisonResponse,
    PercentilesResponse, StockSummary, SymbolListResponse,
    RegimeResponse, TrendPersistenceResponse, InsightsResponse,
    AnalogResponse,
)
from app.models.stock_advanced import (
    StatisticalSignalsResponse, VolatilityLabResponse,
    RegimeClustersResponse, PatternMatchResponse, MarketDynamicsResponse,
    ZScoreResponse, DualMomentumResponse,
)

router = APIRouter(prefix="/api/stock", tags=["stock"])


def _check_symbol(symbol: str, symbols: list[str]) -> None:
    if symbol.upper() not in symbols:
        raise HTTPException(status_code=404, detail=f"Symbol '{symbol}' not found")


@router.post("/invalidate")
def invalidate_stock_cache():
    n1 = stock_metrics.invalidate_cache()
    n2 = stock_metrics_advanced.invalidate_cache()
    return {"status": "invalidated", "cleared": n1 + n2}


@router.get("/symbols", response_model=SymbolListResponse)
def list_symbols():
    return SymbolListResponse(symbols=stock_metrics.get_symbols())


@router.get("/{symbol}/summary", response_model=StockSummary)
def stock_summary(symbol: str):
    try:
        return stock_metrics.get_summary(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/ohlcv", response_model=OHLCVResponse)
def stock_ohlcv(symbol: str):
    try:
        return stock_metrics.get_ohlcv(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/relative-strength", response_model=RelativeStrengthResponse)
def stock_relative_strength(symbol: str):
    try:
        return stock_metrics.get_relative_strength(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/returns", response_model=ReturnsResponse)
def stock_returns(symbol: str):
    try:
        return stock_metrics.get_returns(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/risk", response_model=RiskResponse)
def stock_risk(symbol: str):
    try:
        return stock_metrics.get_risk(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/drawdown", response_model=DrawdownResponse)
def stock_drawdown(symbol: str):
    try:
        return stock_metrics.get_drawdown(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/market-comparison", response_model=MarketComparisonResponse)
def stock_market_comparison(symbol: str):
    try:
        return stock_metrics.get_market_comparison(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/percentiles", response_model=PercentilesResponse)
def stock_percentiles(symbol: str):
    try:
        return stock_metrics.get_percentiles(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/regime", response_model=RegimeResponse)
def stock_regime(symbol: str):
    try:
        return stock_metrics.get_regime(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/trend-persistence", response_model=TrendPersistenceResponse)
def stock_trend_persistence(symbol: str):
    try:
        return stock_metrics.get_trend_persistence(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/insights", response_model=InsightsResponse)
def stock_insights(symbol: str):
    try:
        return stock_metrics.get_insights(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/analogs", response_model=AnalogResponse)
def stock_analogs(symbol: str):
    try:
        return stock_metrics.get_analogs(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/zscore", response_model=ZScoreResponse)
def stock_zscore(symbol: str):
    try:
        return stock_metrics_advanced.get_zscore(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/dual-momentum", response_model=DualMomentumResponse)
def stock_dual_momentum(symbol: str):
    try:
        return stock_metrics_advanced.get_dual_momentum(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/statistical-signals", response_model=StatisticalSignalsResponse)
def stock_statistical_signals(symbol: str):
    try:
        return stock_metrics_advanced.get_statistical_signals(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/volatility-lab", response_model=VolatilityLabResponse)
def stock_volatility_lab(symbol: str):
    try:
        return stock_metrics_advanced.get_volatility_lab(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/regime-clusters", response_model=RegimeClustersResponse)
def stock_regime_clusters(symbol: str):
    try:
        return stock_metrics_advanced.get_regime_clusters(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/pattern-match", response_model=PatternMatchResponse)
def stock_pattern_match(symbol: str):
    try:
        return stock_metrics_advanced.get_pattern_match(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/market-dynamics", response_model=MarketDynamicsResponse)
def stock_market_dynamics(symbol: str):
    try:
        return stock_metrics_advanced.get_market_dynamics(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
