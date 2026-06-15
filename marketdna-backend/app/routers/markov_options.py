from fastapi import APIRouter, HTTPException
from app.services import markov_options_service
from app.models.markov_options import MarkovOptionsResult, MarketMarkovResult

router = APIRouter(prefix="/api/markov-options", tags=["markov-options"])


@router.get("/market", response_model=MarketMarkovResult)
def market_regimes():
    """Scan all symbols — current regime, next-month forecast, options strategy."""
    try:
        return markov_options_service.get_market()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/market/invalidate", response_model=dict)
def invalidate():
    markov_options_service.invalidate_cache()
    return {"status": "cache cleared"}


@router.get("/{symbol}", response_model=MarkovOptionsResult)
def symbol_regime(symbol: str):
    """Full Markov regime history + transition matrix + next-month forecast for one stock."""
    try:
        return markov_options_service.get_symbol(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
