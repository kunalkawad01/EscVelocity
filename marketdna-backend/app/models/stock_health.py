"""Pydantic models for Stock Health Report."""
from typing import Optional
from pydantic import BaseModel


class DrawdownPoint(BaseModel):
    date: str
    drawdown: float  # % negative value e.g. -12.3


class CrashResistance(BaseModel):
    covid_2020: Optional[float] = None       # stock return fraction in Feb-Mar 2020
    correction_2022: Optional[float] = None  # Jan-Jun 2022
    selloff_2024: Optional[float] = None     # Sep-Nov 2024


class RegimePerformance(BaseModel):
    bull: Optional[float] = None     # cumulative return fraction during bull days
    bear: Optional[float] = None
    sideways: Optional[float] = None
    bull_days: int = 0
    bear_days: int = 0
    sideways_days: int = 0


class AlphaHalfLife(BaseModel):
    m1: Optional[float] = None
    m3: Optional[float] = None
    m6: Optional[float] = None
    m12: Optional[float] = None


class CoreReturns(BaseModel):
    cagr: float                  # annualised % e.g. 12.3
    consistency_score: float     # 0-1 fraction of positive months
    return_concentration: float  # 0-1 fraction of total return from top-5 days
    capital_efficiency: float    # cagr_frac / abs(max_dd_frac)


class Resilience(BaseModel):
    max_drawdown: float                    # % negative e.g. -28.4
    drawdown_frequency: int               # count of ≥10% drawdowns
    avg_recovery_days: Optional[float]    # trading days avg; None if no deep drawdowns
    time_under_water: float               # 0-1


class TrendQuality(BaseModel):
    trend_efficiency: float       # 0-1
    wealth_smoothness_r2: float   # 0-1 log-linear R²
    skill_ratio: float            # cagr_ex_top10 / cagr (fraction)
    cagr_ex_top1: float           # CAGR after removing best 1 day (annualised %)
    cagr_ex_top5: float
    cagr_ex_top10: float


class Behavioral(BaseModel):
    pain_to_gain: float               # lower is better
    anti_fragility: float             # corr(rolling_vol, fwd_return); can be negative
    opportunity_cost: float           # 0-1 fraction of time within ±5% of 52w start
    momentum_persistence_3d: float    # P(up | 3 consecutive up days)
    momentum_persistence_5d: float
    momentum_persistence_7d: float


class CompositeScores(BaseModel):
    conviction: float          # 0-100
    swan: float                # 0-100
    compounding_quality: float # 0-100


class ArchetypeSummary(BaseModel):
    symbol: str
    archetype: str
    conviction: float
    swan: float
    compounding_quality: float
    cagr: float
    max_drawdown: float
    years: float


class ArchetypeScanResponse(BaseModel):
    items: list['ArchetypeSummary']
    ready: bool
    computed: int
    total: int


class StockHealthReport(BaseModel):
    symbol: str
    data_start: str
    data_end: str
    years: float
    archetype: str
    core_returns: CoreReturns
    resilience: Resilience
    trend_quality: TrendQuality
    behavioral: Behavioral
    composite_scores: CompositeScores
    crash_resistance: CrashResistance
    regime_performance: RegimePerformance
    alpha_half_life: AlphaHalfLife
    drawdown_series: list[DrawdownPoint]  # full history
    computed_at: str
