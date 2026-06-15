from fastapi import APIRouter, HTTPException, Query
from app.services import pattern_service, validation_service
from app.models.pattern import (
    PatternDetection, PatternDNAResponse,
    PatternScannerResponse, PatternScreenerResponse,
    ConfirmedFormingResponse,
    PatternHistoryResponse,
    BreakoutTrackerResponse,
    PatternHeatmapResponse,
    RegimeDNAResponse,
    PatternFailureResponse,
)
from app.models.validation import ValidationReport

router = APIRouter(prefix="/api/patterns", tags=["patterns"])

VALID_SCREENER_PATTERNS = {
    "Double Bottom", "Double Top",
    "Bull Flag", "Bear Flag",
    "Head & Shoulders", "Inverse Head & Shoulders",
    "Ascending Triangle", "Descending Triangle",
    "Rectangle",
}


@router.get("/scanner", response_model=PatternScannerResponse)
def pattern_scanner(timeframe: str = Query('daily', pattern='^(daily|weekly)$')):
    try:
        return pattern_service.get_scanner(timeframe=timeframe)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/screener/{pattern_name}", response_model=PatternScreenerResponse)
def pattern_screener(pattern_name: str):
    decoded = pattern_name.replace("-", " ").title()
    if decoded not in VALID_SCREENER_PATTERNS:
        raise HTTPException(
            status_code=400,
            detail=f"Pattern '{decoded}' not supported. Valid: {sorted(VALID_SCREENER_PATTERNS)}",
        )
    try:
        return pattern_service.get_screener(decoded)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/validation", response_model=ValidationReport)
def pattern_validation():
    """
    Run the full 4-step validation suite (cached after first run, ~60–180s cold start).
    Steps: (1) min occurrences=12, (2) IS/OOS split, (3) decile analysis, (4) confidence calibration.
    """
    try:
        return validation_service.run_full_validation()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/validation/invalidate", response_model=dict)
def invalidate_validation_cache():
    """Force the next /validation call to re-run from scratch."""
    validation_service.invalidate_cache()
    return {"status": "cache cleared"}


@router.get("/confirmed-forming", response_model=ConfirmedFormingResponse)
def confirmed_forming(timeframe: str = Query('daily', pattern='^(daily|weekly)$')):
    try:
        return pattern_service.get_confirmed_forming(timeframe=timeframe)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Feature 2: Breakout Tracker (static path — must be before /{symbol} routes) ─

@router.get("/breakout-tracker", response_model=BreakoutTrackerResponse)
def breakout_tracker(days_back: int = Query(60, ge=10, le=120)):
    """Patterns detected in the last N trading days — Confirmed / Forming / Failed status."""
    try:
        return pattern_service.get_breakout_tracker(days_back=days_back)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Feature 3: Market Pattern Heatmap (static path) ───────────────────────────

@router.get("/heatmap", response_model=PatternHeatmapResponse)
def pattern_heatmap(timeframe: str = Query('daily', pattern='^(daily|weekly)$')):
    """Which patterns are clustering across the market right now."""
    try:
        return pattern_service.get_pattern_heatmap(timeframe=timeframe)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Feature 5: Pattern Failure Analysis (static-ish path) ─────────────────────

@router.get("/failures/{pattern_name}", response_model=PatternFailureResponse)
def pattern_failures(pattern_name: str):
    """Stocks that consistently fail a given pattern."""
    decoded = pattern_name.replace("-", " ").title()
    if decoded not in VALID_SCREENER_PATTERNS:
        raise HTTPException(
            status_code=400,
            detail=f"Pattern '{decoded}' not supported. Valid: {sorted(VALID_SCREENER_PATTERNS)}",
        )
    try:
        return pattern_service.get_pattern_failures(decoded)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Dynamic {symbol} routes ───────────────────────────────────────────────────

@router.get("/{symbol}/detect", response_model=list[PatternDetection])
def detect_patterns(symbol: str, timeframe: str = Query('daily', pattern='^(daily|weekly)$')):
    try:
        return pattern_service.detect_current_patterns(symbol.upper(), timeframe=timeframe)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/dna", response_model=PatternDNAResponse)
def pattern_dna(symbol: str):
    try:
        return pattern_service.get_pattern_dna(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Feature 1: Pattern History Timeline ───────────────────────────────────────

@router.get("/{symbol}/history", response_model=PatternHistoryResponse)
def pattern_history(
    symbol: str,
    timeframe: str = Query('daily', pattern='^(daily|weekly)$'),
):
    """All historical pattern detections for a stock with actual forward-return outcomes."""
    try:
        return pattern_service.get_pattern_history(symbol.upper(), timeframe=timeframe)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Feature 4: Regime-Conditioned DNA ─────────────────────────────────────────

@router.get("/{symbol}/regime-dna", response_model=RegimeDNAResponse)
def regime_dna(symbol: str):
    """Pattern DNA split by market regime (Bull / Sideways / Bear) at time of detection."""
    try:
        return pattern_service.get_regime_dna(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
