"""Pydantic models for Regime Score and Market Breadth Score."""
from pydantic import BaseModel


class RegimeComponents(BaseModel):
    """Breakdown of the three sub-scores that sum to the regime score."""
    price_score: float     # 0–40  — price vs SMA position
    alignment_score: float # 0–30  — SMA bull-stack alignment
    slope_score: float     # 0–30  — SMA trend direction


class SMASummary(BaseModel):
    """Current SMA levels and whether price is above each one."""
    sma20: float
    sma50: float
    sma100: float
    sma200: float
    above_sma20: bool
    above_sma50: bool
    above_sma100: bool
    above_sma200: bool


class SlopeInfo(BaseModel):
    """SMA slope values (% change over lookback) and direction flags."""
    sma20_slope: float   # % change over 5 trading days
    sma50_slope: float   # % change over 10 trading days
    sma200_slope: float  # % change over 20 trading days
    sma20_rising: bool
    sma50_rising: bool
    sma200_rising: bool


class RegimeHistoryPoint(BaseModel):
    date: str
    close: float
    regime_score: float


class RegimeScoreResult(BaseModel):
    symbol: str
    date: str
    close: float
    regime_score: float      # 0–100 composite
    regime_label: str        # "Strong Bull" | "Moderate Bull" | "Neutral" | "Moderate Bear" | "Strong Bear"
    components: RegimeComponents
    sma: SMASummary
    slope: SlopeInfo
    sma_fully_aligned: bool  # True when SMA20 > SMA50 > SMA100 > SMA200
    history: list[RegimeHistoryPoint]  # last 252 trading days
    computed_at: str


class BreadthHistoryPoint(BaseModel):
    date: str
    breadth_score: float
    pct_above_sma20: float
    pct_above_sma50: float
    pct_above_sma200: float


class BreadthScoreResult(BaseModel):
    date: str
    pct_above_sma20: float   # % of NIFTY 50 stocks with close > SMA20
    pct_above_sma50: float
    pct_above_sma200: float
    count_above_sma20: int
    count_above_sma50: int
    count_above_sma200: int
    total_symbols: int
    breadth_score: float     # 0–100 weighted composite
    breadth_label: str       # "Broad Participation" | "Moderate Breadth" | "Narrow Breadth" | "Poor Breadth"
    history: list[BreadthHistoryPoint]  # last 252 trading days
    computed_at: str


class StockRegimeSummary(BaseModel):
    symbol: str
    regime_score: float
    regime_label: str
    close: float
    above_sma200: bool
    sma_fully_aligned: bool
    price_score: float
    alignment_score: float
    slope_score: float


class MarketRegimeSnapshot(BaseModel):
    date: str
    breadth: BreadthScoreResult
    stocks: list[StockRegimeSummary]
    avg_regime_score: float
    strong_bull_count: int   # regime_score >= 80
    bull_count: int          # 60 ≤ score < 80
    neutral_count: int       # 40 ≤ score < 60
    bear_count: int          # 20 ≤ score < 40
    strong_bear_count: int   # score < 20
    computed_at: str
