"""Trade Decision Service — orchestrates TradeDecisionAgent for API layer.

Provides:
  - analyze(symbol, direction, instrument_type, ...) → TradeBriefResponse
  - scan(instrument_types, min_confidence, max_results) → ScanResponse

The agent itself lives in agents/trade_decision_agent.py.
This service is the thin bridge between the FastAPI router and the agent.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from app.models.trade_decision import (
    TradeBriefResponse, ScanResponse, ScanSetupOut,
    MarketContextOut, InstrumentAnalysisOut, SignalConvergenceOut,
    RiskCalibrationOut, HistoricalContextOut,
    Direction, InstrumentType,
)

log = logging.getLogger(__name__)

# ── Lazy agent import (avoids circular import at module level) ─────────────────

def _get_agent():
    import sys
    from pathlib import Path
    # Ensure agents/ directory is on path (repo root)
    root = Path(__file__).parents[3]  # marketdna-backend/../..  = repo root
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from agents.trade_decision_agent import TradeDecisionAgent
    return TradeDecisionAgent()


# ── Dataclass → Pydantic bridge ────────────────────────────────────────────────

def _brief_to_response(brief) -> TradeBriefResponse:
    """Convert agent TradeBrief dataclass to Pydantic TradeBriefResponse."""
    r = brief.risk_calibration
    entry_low  = r.entry_zone[0] if r.entry_zone else None
    entry_high = r.entry_zone[1] if r.entry_zone else None

    return TradeBriefResponse(
        symbol=brief.symbol,
        direction=brief.direction,
        instrument_type=brief.instrument_type,
        entry_price=brief.entry_price,

        market_context=MarketContextOut(
            regime_score=brief.market_context.regime_score,
            breadth_score=brief.market_context.breadth_score,
            vix_level=brief.market_context.vix_level,
            posture=brief.market_context.posture,
            market_score=brief.market_context.market_score,
            key_insight=brief.market_context.key_insight,
        ),
        instrument_analysis=InstrumentAnalysisOut(
            instrument_score=brief.instrument_analysis.instrument_score,
            dna_score=brief.instrument_analysis.dna_score,
            regime_score=brief.instrument_analysis.regime_score,
            rs_score=brief.instrument_analysis.rs_score,
            iv_rank=brief.instrument_analysis.iv_rank,
            basis_premium=brief.instrument_analysis.basis_premium,
            oi_trend=brief.instrument_analysis.oi_trend,
            delivery_signal=brief.instrument_analysis.delivery_signal,
            key_metrics=brief.instrument_analysis.key_metrics,
            key_insight=brief.instrument_analysis.key_insight,
        ),
        signal_convergence=SignalConvergenceOut(
            alignment_score=brief.signal_convergence.alignment_score,
            confirming_signals=brief.signal_convergence.confirming_signals,
            contradicting_signals=brief.signal_convergence.contradicting_signals,
            neutral_signals=brief.signal_convergence.neutral_signals,
            pattern_active=brief.signal_convergence.pattern_active,
            key_insight=brief.signal_convergence.key_insight,
        ),
        risk_calibration=RiskCalibrationOut(
            risk_score=brief.risk_calibration.risk_score,
            risk_reward_ratio=brief.risk_calibration.risk_reward_ratio,
            entry_low=entry_low,
            entry_high=entry_high,
            stop_loss=brief.risk_calibration.stop_loss,
            target_1=brief.risk_calibration.target_1,
            target_2=brief.risk_calibration.target_2,
            position_size_pct=brief.risk_calibration.position_size_pct,
            max_risk_pct=brief.risk_calibration.max_risk_pct,
            atr_20=brief.risk_calibration.atr_20,
            key_insight=brief.risk_calibration.key_insight,
        ),
        historical_context=HistoricalContextOut(
            historical_score=brief.historical_context.historical_score,
            win_rate_similar=brief.historical_context.win_rate_similar,
            comparable_setups_count=brief.historical_context.comparable_setups_count,
            avg_gain_on_wins=brief.historical_context.avg_gain_on_wins,
            avg_loss_on_losses=brief.historical_context.avg_loss_on_losses,
            regime_win_rate=brief.historical_context.regime_win_rate,
            key_insight=brief.historical_context.key_insight,
        ),

        confidence=brief.confidence,
        verdict=brief.verdict,
        verdict_color=brief.verdict_color,
        narrative=brief.narrative,
        trade_checklist=brief.trade_checklist,
    )


# ── Public API ─────────────────────────────────────────────────────────────────

async def analyze(
    symbol:          str,
    direction:       Direction,
    instrument_type: InstrumentType,
    entry_price:     float | None = None,
    account_size:    float | None = None,
) -> TradeBriefResponse:
    """Run full 5-sub-agent analysis for a single trade decision."""
    agent = _get_agent()
    brief = await agent.analyze(
        symbol=symbol,
        direction=direction,
        instrument_type=instrument_type,
        entry_price=entry_price,
        account_size=account_size,
    )
    return _brief_to_response(brief)


async def scan(
    instrument_types: list[InstrumentType] | None = None,
    min_confidence:   float = 55.0,
    max_results:      int   = 20,
) -> ScanResponse:
    """
    Scan NIFTY 50 universe for high-confidence setups.
    Returns compact ScanSetupOut items sorted by confidence (desc).
    """
    from app.services.stock_metrics import get_universe

    instrument_types = instrument_types or ["EQUITY"]
    symbols = get_universe()[:60]   # cap to top-60 for speed

    agent  = _get_agent()
    setups: list[ScanSetupOut] = []

    # Run equity scans in batches of 10 (avoid overwhelming DuckDB)
    for i in range(0, len(symbols), 10):
        batch = symbols[i : i + 10]
        tasks = []
        for sym in batch:
            # Default: try LONG and SHORT, keep the better one
            tasks.append(agent.analyze(sym, "LONG", "EQUITY"))
            tasks.append(agent.analyze(sym, "SHORT", "EQUITY"))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        for brief in results:
            if isinstance(brief, Exception):
                continue
            if brief.confidence < min_confidence:
                continue

            r = brief.instrument_analysis
            setups.append(ScanSetupOut(
                symbol=brief.symbol,
                direction=brief.direction,
                instrument_type=brief.instrument_type,
                confidence=brief.confidence,
                verdict=brief.verdict,
                verdict_color=brief.verdict_color,
                regime_score=r.regime_score or brief.market_context.regime_score,
                dna_score=r.dna_score,
                rs_score=r.rs_score,
                iv_rank=r.iv_rank,
                signal_count=len(brief.signal_convergence.confirming_signals),
                one_liner=brief.market_context.key_insight,
            ))

    # De-duplicate: keep best direction per symbol
    seen: dict[str, ScanSetupOut] = {}
    for s in setups:
        if s.symbol not in seen or s.confidence > seen[s.symbol].confidence:
            seen[s.symbol] = s

    final = sorted(seen.values(), key=lambda x: x.confidence, reverse=True)[:max_results]

    return ScanResponse(
        setups=final,
        total_scanned=len(symbols),
        generated_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
    )
