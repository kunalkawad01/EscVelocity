"""Company Intelligence endpoints — Claude API + Kite + DuckDB."""
from __future__ import annotations

import json
from fastapi import APIRouter, HTTPException

from app.services.intelligence_service import (
    get_intelligence,
    get_live_quote,
    get_fundamentals,
    clear_cache,
    cache_status as _cache_status,
)

router = APIRouter(prefix="/api/intelligence", tags=["intelligence"])


@router.post("/{ticker}")
async def intelligence_endpoint(ticker: str):
    """Qualitative company analysis via Claude. Cache TTL: 24 h."""
    ticker = ticker.upper().strip()
    try:
        return await get_intelligence(ticker)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"Claude returned invalid JSON: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/quote/{ticker}")
def quote_endpoint(ticker: str):
    """Live quote from Kite Connect (price, volume, OI, depth)."""
    ticker = ticker.upper().strip()
    result = get_live_quote(ticker)
    if result is None:
        raise HTTPException(status_code=502, detail="Kite quote unavailable — check access token")
    return result


@router.get("/fundamentals/{ticker}")
def fundamentals_endpoint(ticker: str):
    """Historical metrics from DuckDB OHLCV: 52W range, avg vol, realised vol, 1Y return."""
    ticker = ticker.upper().strip()
    return get_fundamentals(ticker)


@router.delete("/cache/{ticker}")
def invalidate_cache(ticker: str):
    """Bust cached Claude analysis for a single ticker."""
    ticker = ticker.upper().strip()
    clear_cache(ticker)
    return {"status": "cleared", "ticker": ticker}


@router.get("/cache/status/{ticker}")
def cache_status_endpoint(ticker: str):
    """Check whether a ticker has a fresh cached analysis."""
    return _cache_status(ticker.upper().strip())
