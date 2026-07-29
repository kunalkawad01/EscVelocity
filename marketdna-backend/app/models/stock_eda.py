"""Pydantic models for the Stock EDA page — visualization-heavy exploratory stats."""
from typing import Optional
from pydantic import BaseModel


# ─── Volatility Clustering ─────────────────────────────────────────────────────

class VolatilityPoint(BaseModel):
    date: str
    realized_vol_20d: float   # annualised %, rolling 20d std of daily returns
    vol_of_vol_20d: float     # rolling 20d std of realized_vol_20d itself


class VolatilitySeriesResponse(BaseModel):
    symbol: str
    series: list[VolatilityPoint]
    current_vol: float
    vol_percentile: float  # current_vol's percentile vs its own history


# ─── Drawdown History (worst episodes table) ───────────────────────────────────

class DrawdownEpisode(BaseModel):
    start_date: str
    trough_date: str
    recovery_date: Optional[str] = None   # None if not yet recovered
    depth_pct: float                      # negative
    duration_days: int                    # start -> trough
    recovery_days: Optional[int] = None   # trough -> recovery; None if ongoing


class DrawdownHistoryResponse(BaseModel):
    symbol: str
    episodes: list[DrawdownEpisode]   # worst 10 by depth


# ─── Seasonality ────────────────────────────────────────────────────────────────

class SeasonalityCell(BaseModel):
    month: int          # 1-12
    day_of_week: int    # 0=Mon .. 4=Fri
    avg_return_pct: float
    n: int


class SeasonalityResponse(BaseModel):
    symbol: str
    grid: list[SeasonalityCell]
    best_month: int
    worst_month: int


# ─── Gap Analysis ───────────────────────────────────────────────────────────────

class GapPoint(BaseModel):
    date: str
    gap_pct: float
    filled: bool


class GapBucket(BaseModel):
    label: str          # e.g. "0-1%", "1-2%", ">3%"
    count: int
    fill_rate_pct: float


class GapsResponse(BaseModel):
    symbol: str
    points: list[GapPoint]
    buckets: list[GapBucket]
    overall_fill_rate_pct: float


# ─── Volume Profile ─────────────────────────────────────────────────────────────

class VolumeProfileBin(BaseModel):
    price_low: float
    price_high: float
    volume: int


class VolumeProfileResponse(BaseModel):
    symbol: str
    bins: list[VolumeProfileBin]
    point_of_control: float   # price of the highest-volume bin (midpoint)
    lookback_bars: int


# ─── Autocorrelation ────────────────────────────────────────────────────────────

class ACFPoint(BaseModel):
    lag: int
    value: float


class AutocorrelationResponse(BaseModel):
    symbol: str
    acf: list[ACFPoint]
    significance_band: float   # +/- this value at 95% confidence


# ─── Extreme Days ────────────────────────────────────────────────────────────────

class ExtremeDay(BaseModel):
    date: str
    return_pct: float
    volume_ratio: float   # day's volume / trailing 20d avg volume


class ExtremeDaysResponse(BaseModel):
    symbol: str
    best: list[ExtremeDay]    # top 15
    worst: list[ExtremeDay]   # worst 15


# ─── Benchmark Comparison (last 5 days) ─────────────────────────────────────────

class BenchmarkDayComparison(BaseModel):
    date: str
    stock_return_pct: float
    sector_return_pct: float
    nifty50_return_pct: float
    nifty200_return_pct: float
    nifty500_return_pct: float


class BenchmarkComparisonResponse(BaseModel):
    symbol: str
    sector_name: Optional[str] = None
    days: list[BenchmarkDayComparison]
