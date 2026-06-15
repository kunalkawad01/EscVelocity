"""Pydantic models for Short Intelligence."""
from typing import Optional
from pydantic import BaseModel


class ShortCandidate(BaseModel):
    symbol: str
    signal_name: str
    grade: str
    win_rate: float
    expected_value: float
    edge_score: float
    current_delivery_pct: float
    delivery_ratio: float
    current_vol_ratio: float
    regime_score: float          # 0/25/50/75/100 — price vs SMA20/50/100/200
    pct_from_sma20: float        # negative = below SMA20
    pct_from_sma50: float
    max_drawdown_20d: float      # ≤ 0, % from 20D high
    days_below_sma20: int
    mkt_low_win_rate: Optional[float] = None   # WR when market regime < 60
    mkt_low_ev: Optional[float] = None
    is_active: bool
    short_score: float           # composite ranking score


class SqueezeWatch(BaseModel):
    symbol: str
    trigger_signal: str          # bullish signal that appeared in declining stock
    grade: str
    win_rate: float
    expected_value: float
    edge_score: float
    current_delivery_pct: float
    delivery_ratio: float
    current_vol_ratio: float
    regime_score: float
    decline_pct_20d: float       # % from 20D high — negative
    days_below_sma20: int
    pct_from_sma20: float
    mkt_low_win_rate: Optional[float] = None
    is_active: bool
    squeeze_risk: str            # 'High' | 'Medium' | 'Low'
    squeeze_score: float


class MarketContext(BaseModel):
    avg_regime_score: float
    short_candidate_count: int
    squeeze_watch_count: int
    active_short_signals: int
    active_squeeze_signals: int
    computed_at: str


class ShortIntelligenceResult(BaseModel):
    short_candidates: list[ShortCandidate]
    squeeze_watch: list[SqueezeWatch]
    market_context: MarketContext
