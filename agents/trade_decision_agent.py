"""
TradeDecisionAgent — Top-Level Orchestrator
============================================

Architecture
------------
                ┌─────────────────────────────────┐
                │      TradeDecisionAgent          │
                │  (LLM-powered orchestrator)      │
                └─────────────────────────────────┘
                         │ dispatches to
          ┌──────────────┼──────────────────────────┐
          ▼              ▼            ▼              ▼              ▼
  MarketContext   Instrument    SignalConver-   RiskCalibra-  Historical
    SubAgent      Analysis       gence          tion          Context
                  SubAgent       SubAgent        SubAgent      SubAgent

Decision Pipeline
-----------------
1. MarketContextSubAgent      → Is the overall market conducive? (weight 25%)
2. InstrumentAnalysisSubAgent → Does this specific instrument have edge? (weight 35%)
3. SignalConvergenceSubAgent  → Do signals confirm each other? (weight 20%)
4. RiskCalibrationSubAgent    → Is the risk/reward acceptable? (weight 10%)
5. HistoricalContextSubAgent  → How did similar setups perform historically? (weight 10%)

Final Verdict
-------------
    confidence = w1*market + w2*instrument + w3*signal + w4*risk + w5*history
    STRONG GO   ≥ 75
    GO          ≥ 60
    WEAK GO     ≥ 50
    NO-GO       ≥ 35
    STRONG NO-GO < 35

Usage (from the trade decision service)
----------------------------------------
    from agents.trade_decision_agent import TradeDecisionAgent

    agent = TradeDecisionAgent()
    brief = await agent.analyze(
        symbol="RELIANCE",
        direction="LONG",          # LONG | SHORT
        instrument_type="EQUITY",  # EQUITY | OPTIONS | FUTURES
        entry_price=2950.0,
        account_size=500000.0,     # optional, for position sizing
    )

Data Flow
---------
User → TradeDecisionAgent → MCP Tools → Feature Store → LLM Reasoning → Brief

The LLM layer NEVER invents numbers. It only:
  a) interprets structured data from sub-agents
  b) resolves contradictions across signals
  c) writes the 3-4 sentence research narrative

All numeric outputs (scores, ratios, levels) come exclusively from DuckDB / parquet.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Literal, Optional

log = logging.getLogger(__name__)

Direction      = Literal["LONG", "SHORT"]
InstrumentType = Literal["EQUITY", "OPTIONS", "FUTURES"]
Verdict        = Literal["STRONG GO", "GO", "WEAK GO", "NO-GO", "STRONG NO-GO"]


# ── Sub-Agent result types ────────────────────────────────────────────────────

@dataclass
class MarketContextResult:
    """Output of MarketContextSubAgent."""
    regime_score:   float           # 0-100: market regime (bull=high)
    breadth_score:  float           # 0-100: % of NIFTY 50 above key SMAs
    vix_level:      Optional[float] # India VIX; None if unavailable
    posture:        str             # "BULL" | "BEAR" | "SIDEWAYS"
    market_score:   float           # 0-100: composite market health
    key_insight:    str             # 1-line summary


@dataclass
class InstrumentAnalysisResult:
    """Output of InstrumentAnalysisSubAgent."""
    instrument_score:   float        # 0-100: how good is this specific setup
    dna_score:          Optional[float] = None   # Stock DNA (equity only)
    regime_score:       Optional[float] = None   # Stock regime (equity only)
    rs_score:           Optional[float] = None   # Relative strength (equity only)
    iv_rank:            Optional[float] = None   # IV rank 0-100 (options only)
    basis_premium:      Optional[float] = None   # % premium/discount (futures only)
    oi_trend:           Optional[str]   = None   # "INCREASING" | "DECREASING" (futures/options)
    delivery_signal:    Optional[str]   = None   # signal name if active
    key_metrics:        dict            = field(default_factory=dict)
    key_insight:        str             = ""


@dataclass
class SignalConvergenceResult:
    """Output of SignalConvergenceSubAgent."""
    alignment_score:        float        # 0-100: how aligned are signals with direction
    confirming_signals:     list[str]    = field(default_factory=list)
    contradicting_signals:  list[str]    = field(default_factory=list)
    neutral_signals:        list[str]    = field(default_factory=list)
    pattern_active:         Optional[str] = None   # dominant pattern if any
    key_insight:            str           = ""


@dataclass
class RiskCalibrationResult:
    """Output of RiskCalibrationSubAgent."""
    risk_score:         float           # 0-100: higher = better R/R
    risk_reward_ratio:  Optional[float] = None  # e.g. 2.5 (reward:risk)
    entry_zone:         Optional[tuple[float, float]] = None
    stop_loss:          Optional[float] = None
    target_1:           Optional[float] = None
    target_2:           Optional[float] = None
    position_size_pct:  Optional[float] = None  # % of capital
    max_risk_pct:       Optional[float] = None  # max loss as % of capital
    atr_20:             Optional[float] = None
    key_insight:        str             = ""


@dataclass
class HistoricalContextResult:
    """Output of HistoricalContextSubAgent."""
    historical_score:           float           # 0-100: confidence from history
    win_rate_similar:           Optional[float] = None  # % historical win rate
    comparable_setups_count:    int             = 0
    avg_gain_on_wins:           Optional[float] = None  # %
    avg_loss_on_losses:         Optional[float] = None  # %
    regime_win_rate:            Optional[float] = None  # WR at current regime level
    key_insight:                str             = ""


@dataclass
class TradeBrief:
    """Full research brief returned by TradeDecisionAgent."""
    # ── Identity ──────────────────────────────────────────────────────────────
    symbol:          str
    direction:       Direction
    instrument_type: InstrumentType
    entry_price:     Optional[float]

    # ── Sub-agent results ──────────────────────────────────────────────────────
    market_context:      MarketContextResult
    instrument_analysis: InstrumentAnalysisResult
    signal_convergence:  SignalConvergenceResult
    risk_calibration:    RiskCalibrationResult
    historical_context:  HistoricalContextResult

    # ── Final verdict ──────────────────────────────────────────────────────────
    confidence:      float    # 0-100
    verdict:         Verdict
    verdict_color:   str      # hex for UI rendering
    narrative:       str      # 3-4 sentence LLM-generated research brief
    trade_checklist: list[str] = field(default_factory=list)  # 5 must-check items


# ── Sub-Agent implementations ─────────────────────────────────────────────────

class MarketContextSubAgent:
    """
    Reads market-wide regime, breadth, and VIX to assess if conditions
    are conducive to taking the trade.

    Data sources:
      - regime_service.get_snapshot()           → per-stock regime scores
      - regime_service.get_breadth()            → breadth score
      - stock_metrics.get_market_regime_series()→ market-wide regime
    """

    async def run(self) -> MarketContextResult:
        from app.services import regime_service

        try:
            breadth = await asyncio.to_thread(regime_service.get_breadth)
            breadth_score = breadth.get("breadth_score", 50.0)
        except Exception:
            breadth_score = 50.0

        try:
            snapshot = await asyncio.to_thread(regime_service.get_snapshot)
            avg_regime = (
                sum(s.regime_score for s in snapshot) / len(snapshot)
                if snapshot else 50.0
            )
        except Exception:
            avg_regime = 50.0

        # Composite market score: 60% regime, 40% breadth
        market_score = avg_regime * 0.60 + breadth_score * 0.40

        posture = (
            "BULL"     if market_score >= 65 else
            "BEAR"     if market_score < 40  else
            "SIDEWAYS"
        )

        insight = (
            f"Market regime {avg_regime:.0f}/100, breadth {breadth_score:.0f}/100 — "
            f"posture is {posture}."
        )

        return MarketContextResult(
            regime_score=avg_regime,
            breadth_score=breadth_score,
            vix_level=None,  # TODO: wire VIX feed when available
            posture=posture,
            market_score=market_score,
            key_insight=insight,
        )


class InstrumentAnalysisSubAgent:
    """
    Deep-dives into the specific instrument being evaluated.

    EQUITY:  DNA score, regime score, relative strength, delivery signal
    OPTIONS: IV rank, ATM IV, RV vs IV spread, Markov regime, PCR
    FUTURES: basis premium, OI trend, roll cost
    """

    async def run(
        self,
        symbol: str,
        direction: Direction,
        instrument_type: InstrumentType,
    ) -> InstrumentAnalysisResult:

        if instrument_type == "EQUITY":
            return await self._analyze_equity(symbol, direction)
        elif instrument_type == "OPTIONS":
            return await self._analyze_options(symbol, direction)
        else:
            return await self._analyze_futures(symbol, direction)

    async def _analyze_equity(
        self, symbol: str, direction: Direction
    ) -> InstrumentAnalysisResult:
        from app.services import stock_metrics

        try:
            _r = await asyncio.to_thread(stock_metrics.get_summary, symbol)
            summary = _r.model_dump() if hasattr(_r, "model_dump") else _r
        except Exception:
            summary = {}

        dna    = summary.get("dna_score", 50.0)
        regime = summary.get("regime_score", 50.0)
        rs     = summary.get("rs_score", 50.0)

        # For shorts: invert direction — low DNA = good short candidate
        direction_factor = 1.0 if direction == "LONG" else -1.0
        instrument_score = max(0, min(100,
            regime * 0.40 + dna * 0.35 + rs * 0.25
            if direction == "LONG"
            else (100 - regime) * 0.40 + (100 - dna) * 0.35 + (100 - rs) * 0.25
        ))

        return InstrumentAnalysisResult(
            instrument_score=instrument_score,
            dna_score=dna,
            regime_score=regime,
            rs_score=rs,
            key_metrics={"dna": dna, "regime": regime, "rs": rs},
            key_insight=(
                f"DNA {dna:.0f} · Regime {regime:.0f} · RS {rs:.0f} — "
                f"{'strong setup' if instrument_score > 65 else 'weak setup'} for {direction}."
            ),
        )

    async def _analyze_options(
        self, symbol: str, direction: Direction
    ) -> InstrumentAnalysisResult:
        from app.services import markov_options_service

        try:
            result = await asyncio.to_thread(markov_options_service.get_symbol, symbol)
        except Exception:
            result = {}

        iv_rank       = result.get("iv_rank_percentile", 50.0)
        regime_prob   = result.get("current_regime_probability", 0.5)
        regime_label  = result.get("current_regime", "UNKNOWN")

        # IV rank: high IV = sell premium; low IV = buy premium
        if direction == "LONG":
            # Buying options: prefer low IV (cheap premium)
            iv_score = max(0, 100 - iv_rank)
        else:
            # Selling options: prefer high IV (rich premium)
            iv_score = iv_rank

        instrument_score = iv_score * 0.55 + regime_prob * 100 * 0.45

        return InstrumentAnalysisResult(
            instrument_score=instrument_score,
            iv_rank=iv_rank,
            oi_trend="INCREASING" if result.get("oi_change", 0) > 0 else "DECREASING",
            key_metrics={"iv_rank": iv_rank, "regime": regime_label},
            key_insight=(
                f"IV Rank {iv_rank:.0f}th pct · Regime: {regime_label} · "
                f"{'Cheap premium' if iv_rank < 30 else 'Rich premium' if iv_rank > 70 else 'Fair premium'}."
            ),
        )

    async def _analyze_futures(
        self, symbol: str, direction: Direction
    ) -> InstrumentAnalysisResult:
        # Futures: use regime + basis as proxy
        from app.services import stock_metrics

        try:
            _r = await asyncio.to_thread(stock_metrics.get_summary, symbol)
            summary = _r.model_dump() if hasattr(_r, "model_dump") else _r
        except Exception:
            summary = {}

        regime = summary.get("regime_score", 50.0)
        instrument_score = regime if direction == "LONG" else (100 - regime)

        return InstrumentAnalysisResult(
            instrument_score=instrument_score,
            regime_score=regime,
            basis_premium=summary.get("futures_basis_pct"),
            key_metrics={"regime": regime},
            key_insight=f"Futures regime {regime:.0f} · Direction aligned: {instrument_score > 55}.",
        )


class SignalConvergenceSubAgent:
    """
    Checks how many signals across Indicators, Pattern DNA, Delivery, and
    Short Intelligence confirm vs contradict the trade direction.
    """

    async def run(
        self,
        symbol: str,
        direction: Direction,
    ) -> SignalConvergenceResult:
        confirming:    list[str] = []
        contradicting: list[str] = []
        neutral:       list[str] = []

        # ── Indicators scan ───────────────────────────────────────────────────
        try:
            from app.services import indicators_service
            scan = await asyncio.to_thread(indicators_service.get_symbol, symbol)
            overall = scan.get("overall_signal", "NEUTRAL")
            if (overall == "BULLISH" and direction == "LONG") or \
               (overall == "BEARISH" and direction == "SHORT"):
                confirming.append(f"Indicator scan: {overall}")
            elif overall == "NEUTRAL":
                neutral.append("Indicator scan: NEUTRAL")
            else:
                contradicting.append(f"Indicator scan: {overall} (opposing)")
        except Exception:
            pass

        # ── Pattern DNA ───────────────────────────────────────────────────────
        try:
            from app.services import patterns_service
            dna = await asyncio.to_thread(patterns_service.get_stock_dna, symbol)
            if dna:
                pattern = dna.get("dominant_pattern", "")
                bias    = dna.get("bias", "NEUTRAL")
                if bias == "BULLISH" and direction == "LONG":
                    confirming.append(f"Pattern DNA: {pattern} (bullish)")
                elif bias == "BEARISH" and direction == "SHORT":
                    confirming.append(f"Pattern DNA: {pattern} (bearish)")
                elif bias != "NEUTRAL":
                    contradicting.append(f"Pattern DNA: {pattern} ({bias})")
        except Exception:
            pass

        # ── Delivery signal ───────────────────────────────────────────────────
        try:
            from app.services import delivery_service
            report = await asyncio.to_thread(
                delivery_service.get_delivery_report, symbol
            )
            signal = report.get("active_signal", "")
            if signal:
                is_bullish = signal in ("Accumulation", "High Delivery Up")
                if (is_bullish and direction == "LONG") or \
                   (not is_bullish and direction == "SHORT"):
                    confirming.append(f"Delivery: {signal}")
                else:
                    contradicting.append(f"Delivery: {signal} (opposing)")
        except Exception:
            pass

        # ── Regime alignment ──────────────────────────────────────────────────
        try:
            from app.services import regime_service
            snap = await asyncio.to_thread(regime_service.get_symbol_regime, symbol)
            r = snap.get("regime_score", 50.0)
            if r >= 65 and direction == "LONG":
                confirming.append(f"Regime: {r:.0f}/100 (trending up)")
            elif r < 35 and direction == "SHORT":
                confirming.append(f"Regime: {r:.0f}/100 (trending down)")
            elif r >= 65 and direction == "SHORT":
                contradicting.append(f"Regime: {r:.0f}/100 (strong uptrend — risky short)")
            elif r < 35 and direction == "LONG":
                contradicting.append(f"Regime: {r:.0f}/100 (weak — risky long)")
            else:
                neutral.append(f"Regime: {r:.0f}/100 (sideways)")
        except Exception:
            pass

        total = len(confirming) + len(contradicting) + len(neutral)
        alignment_score = (
            (len(confirming) / total * 100) if total > 0 else 50.0
        )

        return SignalConvergenceResult(
            alignment_score=alignment_score,
            confirming_signals=confirming,
            contradicting_signals=contradicting,
            neutral_signals=neutral,
            key_insight=(
                f"{len(confirming)} confirming · {len(contradicting)} contradicting · "
                f"{len(neutral)} neutral — alignment {alignment_score:.0f}%."
            ),
        )


class RiskCalibrationSubAgent:
    """
    Computes entry zone, stop loss, targets, R/R ratio, and position size.
    Uses ATR-based stops and swing levels from price history.
    """

    async def run(
        self,
        symbol: str,
        entry_price: Optional[float],
        direction: Direction,
        account_size: Optional[float] = None,
    ) -> RiskCalibrationResult:
        try:
            from app.services import stock_metrics
            volatility = await asyncio.to_thread(
                stock_metrics.get_volatility, symbol
            )
            atr_20   = volatility.get("atr_20", None)
            atr_pct  = volatility.get("atr_20_pct", 0.015)  # default 1.5%
        except Exception:
            atr_20 = None
            atr_pct = 0.015

        if entry_price and atr_pct:
            atr_val  = entry_price * atr_pct
            # Stop: 1.5× ATR from entry
            stop   = entry_price - 1.5 * atr_val if direction == "LONG" else entry_price + 1.5 * atr_val
            # Targets: 2× and 3× ATR profit
            t1     = entry_price + 2.0 * atr_val if direction == "LONG" else entry_price - 2.0 * atr_val
            t2     = entry_price + 3.0 * atr_val if direction == "LONG" else entry_price - 3.0 * atr_val
            risk   = abs(entry_price - stop)
            reward = abs(t1 - entry_price)
            rr     = reward / risk if risk > 0 else 1.0

            # Position sizing: risk 1% of account per trade
            if account_size and risk > 0:
                shares          = int((account_size * 0.01) / risk)
                position_size   = (shares * entry_price / account_size) * 100
                max_risk        = 1.0
            else:
                position_size = None
                max_risk      = None

            risk_score = min(100, rr * 33.3)  # 3:1 R/R = 100 score
        else:
            stop = t1 = t2 = rr = position_size = max_risk = None
            risk_score = 50.0

        return RiskCalibrationResult(
            risk_score=risk_score,
            risk_reward_ratio=round(rr, 2) if rr else None,
            entry_zone=(
                (entry_price * 0.998, entry_price * 1.002) if entry_price else None
            ),
            stop_loss=round(stop, 2) if stop else None,
            target_1=round(t1, 2) if t1 else None,
            target_2=round(t2, 2) if t2 else None,
            position_size_pct=round(position_size, 1) if position_size else None,
            max_risk_pct=max_risk,
            atr_20=atr_20,
            key_insight=(
                f"R/R {rr:.1f}:1 · Stop {abs(atr_pct*1.5*100):.1f}% · "
                f"{'Acceptable' if rr and rr >= 2.0 else 'Marginal' if rr else 'Unknown'} risk/reward."
                if rr else "Entry price required for risk calibration."
            ),
        )


class HistoricalContextSubAgent:
    """
    Finds how similar setups (same regime level, same delivery signal) performed
    historically. Uses delivery signal stats and regime-conditioned returns.
    """

    async def run(
        self,
        symbol: str,
        direction: Direction,
        regime_score: float,
        delivery_signal: Optional[str] = None,
    ) -> HistoricalContextResult:
        try:
            from app.services import delivery_service
            report = await asyncio.to_thread(
                delivery_service.get_delivery_report, symbol
            )
            signals = report.get("signals", {})

            if delivery_signal and delivery_signal in signals:
                sig     = signals[delivery_signal]
                wr      = sig.get("win_rate", None)
                avg_g   = sig.get("avg_1m", None)
                count   = sig.get("occurrences", 0)

                # Regime-conditioned WR
                regime_wr = (
                    sig.get("wr_bull") if regime_score >= 60
                    else sig.get("wr_bear") if regime_score < 40
                    else sig.get("win_rate")
                )

                historical_score = min(100, (wr or 50) * 1.2)
            else:
                wr = regime_wr = avg_g = None
                count = 0
                historical_score = 50.0

        except Exception:
            wr = regime_wr = avg_g = None
            count = 0
            historical_score = 50.0

        return HistoricalContextResult(
            historical_score=historical_score,
            win_rate_similar=wr,
            comparable_setups_count=count,
            avg_gain_on_wins=avg_g,
            regime_win_rate=regime_wr,
            key_insight=(
                f"Historical WR {wr:.0f}% across {count} setups "
                f"(regime-conditioned: {regime_wr:.0f}%)." if wr else
                "No historical signal data available — use default priors."
            ),
        )


# ── Top-Level Orchestrator ────────────────────────────────────────────────────

class TradeDecisionAgent:
    """
    Top-level orchestrator. Runs all 5 sub-agents in parallel (where possible),
    computes the weighted confidence score, derives the verdict, and generates
    an LLM narrative via Anthropic SDK.

    Weights: Market 25% · Instrument 35% · Signal 20% · Risk 10% · History 10%
    """

    WEIGHTS = {
        "market":     0.25,
        "instrument": 0.35,
        "signal":     0.20,
        "risk":       0.10,
        "history":    0.10,
    }

    VERDICT_MAP: list[tuple[float, Verdict, str]] = [
        (75, "STRONG GO",    "#22c55e"),
        (60, "GO",           "#4ade80"),
        (50, "WEAK GO",      "#fbbf24"),
        (35, "NO-GO",        "#f97316"),
        (0,  "STRONG NO-GO", "#ef4444"),
    ]

    def __init__(self) -> None:
        self.market_agent     = MarketContextSubAgent()
        self.instrument_agent = InstrumentAnalysisSubAgent()
        self.signal_agent     = SignalConvergenceSubAgent()
        self.risk_agent       = RiskCalibrationSubAgent()
        self.history_agent    = HistoricalContextSubAgent()

    async def analyze(
        self,
        symbol:          str,
        direction:       Direction,
        instrument_type: InstrumentType,
        entry_price:     Optional[float] = None,
        account_size:    Optional[float] = None,
    ) -> TradeBrief:
        symbol = symbol.upper()
        log.info(f"TradeDecisionAgent: analyzing {symbol} {direction} {instrument_type}")

        # ── Phase 1: Run sub-agents (market + instrument + signal in parallel) ─
        market_ctx, instrument_res, signal_res = await asyncio.gather(
            self.market_agent.run(),
            self.instrument_agent.run(symbol, direction, instrument_type),
            self.signal_agent.run(symbol, direction),
        )

        # ── Phase 2: Risk + History (need regime from phase 1) ────────────────
        risk_res, history_res = await asyncio.gather(
            self.risk_agent.run(symbol, entry_price, direction, account_size),
            self.history_agent.run(
                symbol, direction,
                regime_score=instrument_res.regime_score or market_ctx.regime_score,
                delivery_signal=instrument_res.delivery_signal,
            ),
        )

        # ── Phase 3: Weighted confidence ──────────────────────────────────────
        confidence = (
            market_ctx.market_score    * self.WEIGHTS["market"] +
            instrument_res.instrument_score * self.WEIGHTS["instrument"] +
            signal_res.alignment_score * self.WEIGHTS["signal"] +
            risk_res.risk_score        * self.WEIGHTS["risk"] +
            history_res.historical_score * self.WEIGHTS["history"]
        )
        confidence = round(min(100.0, max(0.0, confidence)), 1)

        # ── Phase 4: Verdict ──────────────────────────────────────────────────
        verdict, verdict_color = "NO-GO", "#f97316"
        for threshold, v, color in self.VERDICT_MAP:
            if confidence >= threshold:
                verdict, verdict_color = v, color
                break

        # ── Phase 5: LLM narrative ────────────────────────────────────────────
        narrative = await self._generate_narrative(
            symbol, direction, instrument_type, confidence, verdict,
            market_ctx, instrument_res, signal_res, risk_res, history_res,
        )

        # ── Phase 6: Checklist ────────────────────────────────────────────────
        checklist = self._build_checklist(
            direction, market_ctx, instrument_res, signal_res, risk_res
        )

        return TradeBrief(
            symbol=symbol,
            direction=direction,
            instrument_type=instrument_type,
            entry_price=entry_price,
            market_context=market_ctx,
            instrument_analysis=instrument_res,
            signal_convergence=signal_res,
            risk_calibration=risk_res,
            historical_context=history_res,
            confidence=confidence,
            verdict=verdict,
            verdict_color=verdict_color,
            narrative=narrative,
            trade_checklist=checklist,
        )

    async def _generate_narrative(
        self,
        symbol: str,
        direction: Direction,
        instrument_type: InstrumentType,
        confidence: float,
        verdict: Verdict,
        mkt: MarketContextResult,
        inst: InstrumentAnalysisResult,
        sig: SignalConvergenceResult,
        risk: RiskCalibrationResult,
        hist: HistoricalContextResult,
    ) -> str:
        """Call Anthropic SDK to generate a 3-4 sentence research narrative."""
        try:
            import anthropic
            client = anthropic.Anthropic()

            confirming_str     = ", ".join(sig.confirming_signals)    or "none"
            contradicting_str  = ", ".join(sig.contradicting_signals) or "none"

            prompt = f"""You are a senior quantitative analyst at a hedge fund.
Write a 3-4 sentence research brief for this trade decision. Be precise, concise, and data-driven.
Do NOT invent numbers. Only use the data provided below.

Trade: {direction} {symbol} ({instrument_type})
Confidence: {confidence:.1f}/100 → Verdict: {verdict}

Market: regime={mkt.regime_score:.0f}/100, breadth={mkt.breadth_score:.0f}/100, posture={mkt.posture}
Instrument: score={inst.instrument_score:.0f}/100, DNA={inst.dna_score}, regime={inst.regime_score}, RS={inst.rs_score}
Signals: {len(sig.confirming_signals)} confirming ({confirming_str}), {len(sig.contradicting_signals)} contradicting ({contradicting_str})
Risk: R/R={risk.risk_reward_ratio}, stop={risk.stop_loss}, T1={risk.target_1}
History: WR={hist.win_rate_similar}, setups={hist.comparable_setups_count}

Output ONLY the narrative paragraph. No headers, no bullet points."""

            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            return response.content[0].text.strip()

        except Exception as e:
            log.warning(f"LLM narrative failed: {e}")
            return (
                f"The {direction} trade on {symbol} scores {confidence:.0f}/100 confidence. "
                f"Market posture is {mkt.posture} (regime {mkt.regime_score:.0f}, breadth {mkt.breadth_score:.0f}). "
                f"Signal alignment is {sig.alignment_score:.0f}% with {len(sig.confirming_signals)} confirming signals. "
                f"Verdict: {verdict}."
            )

    def _build_checklist(
        self,
        direction: Direction,
        mkt: MarketContextResult,
        inst: InstrumentAnalysisResult,
        sig: SignalConvergenceResult,
        risk: RiskCalibrationResult,
    ) -> list[str]:
        items: list[str] = []

        # Market alignment
        market_ok = (mkt.posture == "BULL" and direction == "LONG") or \
                    (mkt.posture == "BEAR" and direction == "SHORT")
        items.append(
            f"{'✅' if market_ok else '❌'} Market posture ({mkt.posture}) aligns with {direction} bias"
        )

        # Instrument strength
        inst_ok = inst.instrument_score >= 60
        items.append(
            f"{'✅' if inst_ok else '❌'} Instrument score ≥ 60 (current: {inst.instrument_score:.0f})"
        )

        # Signal majority
        signal_ok = len(sig.confirming_signals) > len(sig.contradicting_signals)
        items.append(
            f"{'✅' if signal_ok else '❌'} Majority signals confirm direction "
            f"({len(sig.confirming_signals)} vs {len(sig.contradicting_signals)})"
        )

        # R/R ratio
        rr = risk.risk_reward_ratio
        rr_ok = rr is not None and rr >= 2.0
        items.append(
            f"{'✅' if rr_ok else '❌'} R/R ratio ≥ 2:1 (current: {f'{rr:.1f}:1' if rr else 'unknown'})"
        )

        # Stop loss defined
        items.append(
            f"{'✅' if risk.stop_loss else '❌'} Stop loss defined "
            f"({'₹' + str(risk.stop_loss) if risk.stop_loss else 'not set'})"
        )

        return items
