"""Pydantic models for Markov Regime + Options Strategy Intelligence."""
from pydantic import BaseModel


REGIMES: list[str] = [
    "Strong Uptrend",
    "Volatile Bull",
    "Sideways Quiet",
    "Sideways Volatile",
    "Steady Bear",
    "Volatile Bear",
]


class RegimeMonth(BaseModel):
    month: str           # "2024-05"
    regime: str
    adx: float
    rsi: float
    pct_vs_sma50: float
    monthly_ret: float
    hv_ratio: float      # HV20 / median_HV20 over history


class TransitionMatrix(BaseModel):
    regimes: list[str]
    matrix: list[list[float]]  # 6×6 blended probabilities
    counts: list[list[int]]    # 6×6 raw observed counts


class OptionsStrategy(BaseModel):
    primary: str
    alternatives: list[str]
    avoid: list[str]
    rationale: str
    iv_action: str       # "Buy" or "Sell"


class RegimeForecast(BaseModel):
    current_regime: str
    probabilities: dict[str, float]  # regime → next-month probability
    dominant_regime: str
    dominant_probability: float
    tail_risk_regime: str | None      # second most likely if ≥15%
    tail_risk_probability: float | None
    strategy: OptionsStrategy


class MarkovOptionsResult(BaseModel):
    symbol: str
    history: list[RegimeMonth]
    matrix: TransitionMatrix
    forecast: RegimeForecast
    n_months: int
    computed_at: str


class MarketRegimeItem(BaseModel):
    symbol: str
    current_regime: str
    dominant_next: str
    dominant_prob: float
    primary_strategy: str
    iv_action: str


class MarketMarkovResult(BaseModel):
    items: list[MarketRegimeItem]
    regime_distribution: dict[str, int]  # current regime counts
    dominant_market_regime: str
    scanned_at: str
