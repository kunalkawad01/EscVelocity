"""Regime Score and Market Breadth API endpoints."""
import logging

from fastapi import APIRouter, HTTPException

from app.models.regime import (
    RegimeScoreResult, BreadthScoreResult, MarketRegimeSnapshot,
)
from app.services import regime_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/regime", tags=["regime"])


@router.get("/breadth", response_model=BreadthScoreResult)
def get_breadth():
    """Market Breadth Score — % of NIFTY 50 above SMA20 / SMA50 / SMA200."""
    try:
        return regime_service.get_breadth_score()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        log.exception("breadth error")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/snapshot", response_model=MarketRegimeSnapshot)
def get_snapshot():
    """Full market regime snapshot — regime score for every NIFTY 50 stock plus breadth."""
    try:
        return regime_service.get_market_snapshot()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        log.exception("snapshot error")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{symbol}", response_model=RegimeScoreResult)
def get_regime(symbol: str):
    """Regime Score for a single stock — score, component breakdown, SMA levels, history."""
    try:
        return regime_service.get_regime_score(symbol.upper())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        log.exception("regime error for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/invalidate")
def invalidate():
    """Clear all regime caches."""
    regime_service.invalidate_cache()
    return {"status": "cache cleared"}
