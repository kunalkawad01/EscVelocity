"""Options OI Analysis router."""
import logging
from fastapi import APIRouter, HTTPException

from app.services import options_service
from app.models.options import (
    OIAnalysis, OIScannerResponse, ExpectedMoveHistory, EMScanResponse, IVSmileResponse,
)

router = APIRouter(prefix="/api/options", tags=["options"])
log = logging.getLogger(__name__)


# ── Static paths must come before /{symbol} ───────────────────────────────────

@router.get("/scan/all", response_model=OIScannerResponse)
def get_scanner():
    """OI buildup scanner across all F&O symbols."""
    result = options_service.get_scanner()
    if result is None:
        raise HTTPException(status_code=503, detail="Options data not available")
    return result


@router.post("/scan/invalidate")
def invalidate_scanner():
    options_service.invalidate_scanner()
    return {"status": "invalidated"}


@router.get("/em-scan", response_model=EMScanResponse)
def get_em_scan():
    """Expected Move scan — all symbols, all dates, with history per symbol."""
    result = options_service.get_em_scan()
    if result is None:
        raise HTTPException(status_code=503, detail="Expected move data not available")
    return result


@router.post("/em-scan/invalidate")
def invalidate_em_scan():
    options_service.invalidate_em_scan()
    return {"status": "invalidated"}


@router.post("/iv-history/rebuild")
def rebuild_iv_history():
    """Rebuild the persisted ATM-IV series (run after post-market options ingestion)."""
    options_service.invalidate_iv_history()
    return {"status": "rebuilt"}


# ── Per-symbol endpoints (sub-paths before bare /{symbol}) ────────────────────

@router.get("/{symbol}/expected-move", response_model=ExpectedMoveHistory)
def get_expected_move(symbol: str):
    """Daily expected move history for a symbol using ATM straddle premium × sqrt(DTE ratio)."""
    result = options_service.get_expected_move_history(symbol.upper())
    if result is None:
        raise HTTPException(status_code=404, detail=f"No expected move data for {symbol}")
    return result


@router.post("/{symbol}/expected-move/invalidate")
def invalidate_expected_move(symbol: str):
    options_service.invalidate_em(symbol.upper())
    return {"status": "invalidated", "symbol": symbol.upper()}


@router.get("/{symbol}/iv-smile", response_model=IVSmileResponse)
def get_iv_smile(symbol: str):
    """Volatility smile + Black-Scholes greeks + skew metrics for the front expiry."""
    result = options_service.get_iv_smile(symbol.upper())
    if result is None:
        raise HTTPException(status_code=404, detail=f"No IV smile data for {symbol}")
    return result


@router.post("/{symbol}/iv-smile/invalidate")
def invalidate_iv_smile(symbol: str):
    options_service.invalidate_iv_smile(symbol.upper())
    return {"status": "invalidated", "symbol": symbol.upper()}


@router.get("/{symbol}", response_model=OIAnalysis)
def get_oi_analysis(symbol: str):
    """Full OI chain for a symbol — max pain, CE/PE walls, strike breakdown."""
    result = options_service.get_oi_analysis(symbol.upper())
    if result is None:
        raise HTTPException(status_code=404, detail=f"No options data for {symbol}")
    return result


@router.post("/{symbol}/invalidate")
def invalidate_symbol(symbol: str):
    options_service.invalidate_symbol(symbol.upper())
    return {"status": "invalidated", "symbol": symbol.upper()}
