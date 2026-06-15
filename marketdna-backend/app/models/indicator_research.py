"""Pydantic models for Indicator IC Research."""
from pydantic import BaseModel


class IndicatorIC(BaseModel):
    name: str
    ic_1m: float            # mean Spearman IC vs 1-month forward return
    ic_3m: float            # mean Spearman IC vs 3-month forward return
    ic_ir_1m: float         # IC / std(IC) at 1M — higher is better
    ic_ir_3m: float         # IC / std(IC) at 3M
    hit_rate_1m: float      # % of periods IC has same sign as mean IC
    hit_rate_3m: float
    n_periods: int          # number of monthly cross-sections used
    direction: str          # "Contrarian" | "Trend Following" | "Mixed" | "Uncorrelated"
    verdict_1m: str         # "Strong" | "Moderate" | "Weak" | "Noise"
    verdict_3m: str


class IndicatorResearchResult(BaseModel):
    indicators: list[IndicatorIC]  # sorted by abs(ic_ir_1m) descending
    best_1m: str                   # indicator with highest |IC IR| at 1M
    best_3m: str                   # indicator with highest |IC IR| at 3M
    n_stocks: int
    n_periods: int
    computed_at: str
