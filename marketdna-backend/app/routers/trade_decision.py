"""Trade Decision Agent routes.

POST /api/trade-decision/analyze  — full 5-sub-agent research brief
POST /api/trade-decision/scan     — scan NIFTY 50 for high-confidence setups
"""
from fastapi import APIRouter, HTTPException
from app.models.trade_decision import (
    AnalyzeRequest, TradeBriefResponse,
    ScanRequest,    ScanResponse,
)
from app.services import trade_decision_service

router = APIRouter(prefix="/api/trade-decision", tags=["trade-decision"])


@router.post("/analyze", response_model=TradeBriefResponse)
async def analyze_trade(req: AnalyzeRequest):
    """
    Run full Trade Decision Agent analysis for a single symbol.

    Orchestrates 5 sub-agents in parallel:
      1. MarketContext      (regime + breadth)
      2. InstrumentAnalysis (DNA / IV / basis)
      3. SignalConvergence  (indicator + pattern + delivery alignment)
      4. RiskCalibration   (ATR-based stop/target/R:R)
      5. HistoricalContext  (delivery signal win-rate history)

    Returns a full TradeBrief with GO/NO-GO verdict + LLM narrative.
    Typical latency: 3–6 seconds.
    """
    try:
        return await trade_decision_service.analyze(
            symbol=req.symbol.upper(),
            direction=req.direction,
            instrument_type=req.instrument_type,
            entry_price=req.entry_price,
            account_size=req.account_size,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/scan", response_model=ScanResponse)
async def scan_setups(req: ScanRequest):
    """
    Scan NIFTY 50 universe for high-confidence setups.

    Runs TradeDecisionAgent on top-60 symbols (LONG + SHORT each) and
    returns setups above min_confidence threshold, sorted by confidence.

    WARNING: This is slow (30–90 seconds). Run once per session.
    """
    try:
        return await trade_decision_service.scan(
            instrument_types=req.instrument_types,
            min_confidence=req.min_confidence,
            max_results=req.max_results,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
