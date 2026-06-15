"""Pydantic models for Indicator Edge Lab."""
from typing import Optional
from pydantic import BaseModel


class SignalStats(BaseModel):
    occurrences: int
    avg_1w: float
    avg_2w: float
    avg_1m: float
    median_1m: float
    max_1m: float
    min_1m: float
    std_1m: float
    win_rate: float
    positive_prob: float
    negative_prob: float
    max_drawdown_1m: float       # avg max adverse excursion during holding period
    distribution: dict[str, int] # return buckets: "<-10", "-10:-5", "-5:0", "0:5", "5:10", ">10"
    expected_value: float
    # Stock regime-conditional stats — None when < MIN_SAMPLES in that bucket
    regime_high_win_rate: Optional[float] = None   # win rate when stock regime ≥ 60 at signal time
    regime_low_win_rate:  Optional[float] = None   # win rate when stock regime < 60 at signal time
    regime_high_ev:       Optional[float] = None   # EV when stock regime ≥ 60
    regime_low_ev:        Optional[float] = None   # EV when stock regime < 60
    regime_high_occurrences: int = 0
    regime_low_occurrences:  int = 0
    # Market regime-conditional stats (avg regime across all 50 NIFTY stocks)
    mkt_regime_high_win_rate: Optional[float] = None
    mkt_regime_low_win_rate:  Optional[float] = None
    mkt_regime_high_ev:       Optional[float] = None
    mkt_regime_low_ev:        Optional[float] = None
    mkt_regime_high_occurrences: int = 0
    mkt_regime_low_occurrences:  int = 0


class ThresholdResult(BaseModel):
    threshold: float
    label: str
    occurrences: int
    avg_1m: float
    win_rate: float
    expected_value: float


class IndicatorEdgeResult(BaseModel):
    name: str
    signal: str
    category: str
    direction: str          # "Bullish" | "Bearish" | "Mixed"
    stats: SignalStats
    grade: str              # A+, A, B, C, D
    edge_score: float
    threshold_sweep: list[ThresholdResult]
    best_threshold: ThresholdResult | None
    is_active: bool


class CurrentSignal(BaseModel):
    indicator: str
    current_value: str
    signal_label: str
    is_active: bool
    stats: SignalStats | None


class IndicatorEdgeReport(BaseModel):
    symbol: str
    data_start: str
    data_end: str
    total_bars: int
    results: list[IndicatorEdgeResult]
    ranked_indicators: list[str]
    best_indicator: str
    best_setup: str
    current_signals: list[CurrentSignal]
    computed_at: str


class StockEdgeSummaryItem(BaseModel):
    symbol: str
    best_indicator: str
    best_signal: str
    grade: str
    direction: str
    edge_score: float
    win_rate: float
    avg_1m: float
    negative_prob: float
    max_drawdown_1m: float
    expected_value: float
    occurrences: int
    is_active: bool


class StockEdgeSummaryResult(BaseModel):
    items: list[StockEdgeSummaryItem]
    total_symbols: int
    computed_at: str
