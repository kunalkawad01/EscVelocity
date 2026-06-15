"""Pydantic models for Delivery Percentage Intelligence."""
from typing import Optional
from pydantic import BaseModel


class SignalOccurrence(BaseModel):
    date: str
    ret_1d: float
    ret_1w: float
    ret_1m: float
    ret_1y: Optional[float] = None   # null when < 252 bars of forward data exist


class DeliverySignalStats(BaseModel):
    occurrences: int
    avg_1d: float
    avg_1w: float
    avg_1m: float
    win_rate: float
    expected_value: float
    max_adverse: float
    distribution: dict[str, int]
    timeline: list[SignalOccurrence]
    # Market regime conditional
    mkt_regime_high_win_rate: Optional[float] = None
    mkt_regime_low_win_rate:  Optional[float] = None
    mkt_regime_high_ev:       Optional[float] = None
    mkt_regime_low_ev:        Optional[float] = None
    mkt_regime_high_occurrences: int = 0
    mkt_regime_low_occurrences:  int = 0


class DeliverySignal(BaseModel):
    name: str
    description: str
    direction: str                  # "Bullish" | "Bearish" | "Mixed"
    is_active: bool
    current_delivery_pct: float
    current_vol_ratio: float
    grade: str
    edge_score: float
    stats: DeliverySignalStats


class DeliveryBar(BaseModel):
    date: str
    close: float
    volume: float
    delivery_pct: float
    vol_ratio: float
    delivery_spike: bool


class DeliveryReport(BaseModel):
    symbol: str
    data_start: str
    data_end: str
    total_bars: int
    current_delivery_pct: float
    avg_delivery_pct_20d: float
    signals: list[DeliverySignal]
    history: list[DeliveryBar]
    computed_at: str


class DeliverySummaryItem(BaseModel):
    symbol: str
    current_delivery_pct: float
    avg_delivery_pct_20d: float
    delivery_ratio: float
    current_vol_ratio: float          # today's volume / 20D avg volume
    best_signal: str
    grade: str
    edge_score: float
    win_rate: float
    is_active: bool
    mkt_regime_high_win_rate: Optional[float] = None
    mkt_regime_low_win_rate:  Optional[float] = None


class DeliverySummaryResult(BaseModel):
    items: list[DeliverySummaryItem]
    total_symbols: int
    computed_at: str
