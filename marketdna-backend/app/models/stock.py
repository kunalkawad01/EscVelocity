from pydantic import BaseModel
from typing import Optional


class Candle(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    sma20: Optional[float] = None
    sma50: Optional[float] = None
    sma200: Optional[float] = None
    daily_return_pct: Optional[float] = None


class OHLCVResponse(BaseModel):
    symbol: str
    candles: list[Candle]


class RankPoint(BaseModel):
    date: str
    rank: int
    total: int
    percentile: float


class RelativeStrengthStats(BaseModel):
    current_rank: int
    best_rank: int
    worst_rank: int
    avg_rank: float
    rank_percentile: float
    total_symbols: int


class RelativeStrengthResponse(BaseModel):
    symbol: str
    ranks: list[RankPoint]
    stats: RelativeStrengthStats


class ReturnHistogramBin(BaseModel):
    bin_start: float
    bin_end: float
    count: int


class ReturnStats(BaseModel):
    mean: float
    median: float
    std: float
    p5: float
    p95: float
    max_val: float
    min_val: float


class ReturnsResponse(BaseModel):
    symbol: str
    daily_histogram: list[ReturnHistogramBin]
    daily_stats: ReturnStats
    monthly_histogram: list[ReturnHistogramBin]
    monthly_returns: list[dict]
    monthly_stats: ReturnStats
    yearly_returns: list[dict]
    yearly_stats: ReturnStats


class ATRPoint(BaseModel):
    date: str
    atr14: float


class RiskStats(BaseModel):
    current_atr: float
    atr_percentile: float
    atr_trend: str  # "rising" | "falling" | "neutral"
    close: float
    atr_pct_of_price: float


class RiskResponse(BaseModel):
    symbol: str
    atr_series: list[ATRPoint]
    stats: RiskStats


class DrawdownPoint(BaseModel):
    date: str
    drawdown_pct: float


class DrawdownStats(BaseModel):
    current_drawdown: float
    max_drawdown: float
    avg_drawdown: float
    days_underwater: int
    total_days: int
    avg_recovery_days: int


class DrawdownResponse(BaseModel):
    symbol: str
    drawdowns: list[DrawdownPoint]
    stats: DrawdownStats


class RatioPoint(BaseModel):
    date: str
    ratio: float
    sma50: Optional[float] = None
    sma200: Optional[float] = None


class MarketComparisonStats(BaseModel):
    current_ratio: float
    ratio_change_1y: float
    status: str  # "Outperforming" | "Underperforming" | "Neutral"


class MarketComparisonResponse(BaseModel):
    symbol: str
    ratio_series: list[RatioPoint]
    stats: MarketComparisonStats


class PercentileMetric(BaseModel):
    metric: str
    current_value: float
    unit: str
    percentile: float
    label: str


class PercentilesResponse(BaseModel):
    symbol: str
    metrics: list[PercentileMetric]


class StockSummary(BaseModel):
    symbol: str
    name: str
    close: float
    change_pct: float
    high_52w: float
    low_52w: float
    avg_volume_20d: float
    above_sma20: bool
    above_sma50: bool
    above_sma200: bool
    regime: str  # "Bullish" | "Bearish" | "Mixed"
    date: str


class SymbolListResponse(BaseModel):
    symbols: list[str]


# ── Sprint 2 models ────────────────────────────────────────────────────────────

class RegimePoint(BaseModel):
    date: str
    regime: str   # 'Bear' | 'Neutral' | 'Bull' | 'Super Bull'
    score: int    # 0-4


class RegimeStats(BaseModel):
    current_regime: str
    prev_regime: str
    days_in_regime: int
    regime_strength: float   # % of last 20 days in same regime


class RegimeResponse(BaseModel):
    symbol: str
    timeline: list[RegimePoint]
    stats: RegimeStats


class SMAStreak(BaseModel):
    label: str             # 'SMA20' | 'SMA50' | 'SMA200'
    current_streak: int
    streak_direction: str  # 'above' | 'below'
    streak_percentile: float


class TrendPersistenceResponse(BaseModel):
    symbol: str
    streaks: list[SMAStreak]


class Insight(BaseModel):
    title: str
    body: str
    category: str      # 'trend' | 'momentum' | 'risk' | 'strength'
    significance: str  # 'high' | 'medium' | 'low'


class InsightsResponse(BaseModel):
    symbol: str
    insights: list[Insight]
    generated_at: str


# ── Sprint 3 models ────────────────────────────────────────────────────────────

class AnalogSnapshot(BaseModel):
    """The current market environment — the fingerprint being matched."""
    regime: str
    regime_score: int
    ret_1m: float
    ret_3m: Optional[float]
    drawdown: float
    atr14: float


class AnalogPeriod(BaseModel):
    """One historical period that closely resembles the current environment."""
    date: str               # anchor date of the analog
    similarity: float       # 0–100, higher = more similar
    regime: str
    drawdown: float
    ret_1m: float           # 1-month return leading into this date
    fwd_1m: Optional[float] # forward 1-month return after this date
    fwd_3m: Optional[float]
    fwd_6m: Optional[float]


class AnalogStats(BaseModel):
    """Aggregated forward-return stats across all analog periods."""
    avg_fwd_1m: float
    avg_fwd_3m: float
    avg_fwd_6m: float
    pct_positive_1m: float  # % of analogs where 1M return was positive
    pct_positive_3m: float


class AnalogResponse(BaseModel):
    symbol: str
    current_snapshot: AnalogSnapshot
    analogs: list[AnalogPeriod]
    stats: AnalogStats
