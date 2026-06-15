"""Short Intelligence service — identifies short candidates and squeeze risk."""
import logging
import time
from datetime import datetime
from typing import Optional

import numpy as np

from app.models.short import (
    MarketContext, ShortCandidate, ShortIntelligenceResult, SqueezeWatch,
)
from app.services.delivery_service import get_delivery_report, _get_delivery_symbols

log = logging.getLogger(__name__)

_CACHE_TTL = 300  # 5 minutes
_cache_result: Optional[ShortIntelligenceResult] = None
_cache_ts: float = 0.0


# ── Price context helpers ─────────────────────────────────────────────────────

def _sma(arr: np.ndarray, n: int) -> float:
    return float(np.mean(arr[-n:])) if len(arr) >= n else float(np.mean(arr))


def _price_context(closes: np.ndarray) -> dict:
    n = len(closes)
    price = closes[-1]

    sma20  = _sma(closes, 20)
    sma50  = _sma(closes, 50)
    sma100 = _sma(closes, 100) if n >= 100 else sma50
    sma200 = _sma(closes, 200) if n >= 200 else sma100

    regime = 0.0
    if price > sma20:  regime += 25
    if price > sma50:  regime += 25
    if price > sma100: regime += 25
    if price > sma200: regime += 25

    recent_20 = closes[-20:] if n >= 20 else closes
    peak_20d  = float(np.max(recent_20))
    drawdown  = (price - peak_20d) / peak_20d * 100  # ≤ 0

    # Consecutive days below SMA20 (scan backwards)
    days_below = 0
    for i in range(1, min(60, n)):
        p  = closes[-i]
        s  = float(np.mean(closes[max(0, -(i + 20)):-i])) if n > i + 20 else sma20
        if p < s:
            days_below += 1
        else:
            break

    return {
        "regime_score":   regime,
        "pct_from_sma20": (price - sma20) / sma20 * 100,
        "pct_from_sma50": (price - sma50) / sma50 * 100,
        "max_drawdown_20d": drawdown,
        "decline_pct_20d":  drawdown,
        "days_below_sma20": days_below,
    }


# ── Scoring ───────────────────────────────────────────────────────────────────

def _short_score(
    edge_score: float, regime_score: float, win_rate: float,
    mkt_low_wr: Optional[float],
) -> float:
    # Amplify when stock already in weak regime (shorts have tailwind)
    regime_factor = 1.0 + max(0.0, (50 - regime_score) / 50) * 0.6
    # Amplify when signal is specifically stronger in weak markets
    weak_boost = 1.0
    if mkt_low_wr is not None and mkt_low_wr > win_rate + 5:
        weak_boost = 1.0 + (mkt_low_wr - win_rate) / 100
    return edge_score * regime_factor * weak_boost


def _squeeze_score(
    edge_score: float, win_rate: float, regime_score: float,
    decline_pct: float, days_below: int, mkt_low_wr: Optional[float],
) -> float:
    # More decline → more trapped shorts → higher squeeze risk
    decline_factor = min(2.5, 1.0 + abs(decline_pct) / 15)
    # Longer below SMA20 → more shorts accumulated
    days_factor = min(1.8, 1.0 + days_below / 30)
    # Weak-mkt signal on a declining stock is most dangerous to shorts
    wr_factor = (win_rate / 100) * (1.0 + (mkt_low_wr or win_rate) / 150)
    return edge_score * decline_factor * days_factor * wr_factor


def _squeeze_risk(score: float) -> str:
    if score >= 6.0: return "High"
    if score >= 2.5: return "Medium"
    return "Low"


# ── Core computation ──────────────────────────────────────────────────────────

def _build_intelligence() -> ShortIntelligenceResult:
    short_candidates: list[ShortCandidate] = []
    squeeze_watch:    list[SqueezeWatch]   = []
    regime_scores:    list[float]          = []

    for symbol in _get_delivery_symbols():
        try:
            report = get_delivery_report(symbol)
        except Exception as exc:
            log.debug("short_service: skip %s — %s", symbol, exc)
            continue

        if not report.history or len(report.history) < 30:
            continue

        closes = np.array([b.close for b in report.history], dtype=float)
        ctx    = _price_context(closes)
        regime_scores.append(ctx["regime_score"])

        last        = report.history[-1]
        cur_del     = last.delivery_pct
        cur_vol     = last.vol_ratio
        cur_del_r   = cur_del / report.avg_delivery_pct_20d if report.avg_delivery_pct_20d else 1.0

        # ── Short candidates: validated bearish signals ───────────────────
        for sig in report.signals:
            if sig.direction != "Bearish":
                continue
            if sig.grade not in ("A+", "A", "B"):
                continue
            if sig.stats.expected_value <= 0:
                continue

            score = _short_score(
                sig.edge_score, ctx["regime_score"],
                sig.stats.win_rate, sig.stats.mkt_regime_low_win_rate,
            )
            short_candidates.append(ShortCandidate(
                symbol=symbol,
                signal_name=sig.name,
                grade=sig.grade,
                win_rate=sig.stats.win_rate,
                expected_value=sig.stats.expected_value,
                edge_score=sig.edge_score,
                current_delivery_pct=cur_del,
                delivery_ratio=cur_del_r,
                current_vol_ratio=cur_vol,
                regime_score=ctx["regime_score"],
                pct_from_sma20=ctx["pct_from_sma20"],
                pct_from_sma50=ctx["pct_from_sma50"],
                max_drawdown_20d=ctx["max_drawdown_20d"],
                days_below_sma20=ctx["days_below_sma20"],
                mkt_low_win_rate=sig.stats.mkt_regime_low_win_rate,
                mkt_low_ev=sig.stats.mkt_regime_low_ev,
                is_active=sig.is_active,
                short_score=round(score, 4),
            ))

        # ── Squeeze watch: declining stock + bullish signal emerging ──────
        is_declining = (
            ctx["regime_score"] <= 50
            or ctx["pct_from_sma20"] < -3
            or ctx["days_below_sma20"] >= 10
        )
        bullish_sigs = [
            s for s in report.signals
            if s.direction == "Bullish" and s.grade in ("A+", "A", "B")
        ]

        if is_declining and bullish_sigs:
            best = max(bullish_sigs, key=lambda s: s.edge_score)
            sq = _squeeze_score(
                best.edge_score, best.stats.win_rate, ctx["regime_score"],
                ctx["decline_pct_20d"], ctx["days_below_sma20"],
                best.stats.mkt_regime_low_win_rate,
            )
            squeeze_watch.append(SqueezeWatch(
                symbol=symbol,
                trigger_signal=best.name,
                grade=best.grade,
                win_rate=best.stats.win_rate,
                expected_value=best.stats.expected_value,
                edge_score=best.edge_score,
                current_delivery_pct=cur_del,
                delivery_ratio=cur_del_r,
                current_vol_ratio=cur_vol,
                regime_score=ctx["regime_score"],
                decline_pct_20d=ctx["decline_pct_20d"],
                days_below_sma20=ctx["days_below_sma20"],
                pct_from_sma20=ctx["pct_from_sma20"],
                mkt_low_win_rate=best.stats.mkt_regime_low_win_rate,
                is_active=best.is_active,
                squeeze_risk=_squeeze_risk(sq),
                squeeze_score=round(sq, 4),
            ))

    avg_regime = float(np.mean(regime_scores)) if regime_scores else 50.0

    return ShortIntelligenceResult(
        short_candidates=sorted(short_candidates, key=lambda x: x.short_score, reverse=True),
        squeeze_watch=sorted(squeeze_watch, key=lambda x: x.squeeze_score, reverse=True),
        market_context=MarketContext(
            avg_regime_score=round(avg_regime, 1),
            short_candidate_count=len(short_candidates),
            squeeze_watch_count=len(squeeze_watch),
            active_short_signals=sum(1 for s in short_candidates if s.is_active),
            active_squeeze_signals=sum(1 for s in squeeze_watch if s.is_active),
            computed_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        ),
    )


# ── Public API ────────────────────────────────────────────────────────────────

def get_short_intelligence() -> ShortIntelligenceResult:
    global _cache_result, _cache_ts
    now = time.time()
    if _cache_result is None or (now - _cache_ts) > _CACHE_TTL:
        log.info("short_service: rebuilding intelligence cache")
        _cache_result = _build_intelligence()
        _cache_ts = now
    return _cache_result


def invalidate_cache() -> None:
    global _cache_result, _cache_ts
    _cache_result = None
    _cache_ts = 0.0
