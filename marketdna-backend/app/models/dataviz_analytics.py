"""Pydantic models for DataViz analytics endpoints."""
from pydantic import BaseModel


class HistogramBucket(BaseModel):
    center: float
    count: int


class HistogramStats(BaseModel):
    mean: float
    median: float
    std: float
    skew: float
    min_val: float
    max_val: float


class HistogramResponse(BaseModel):
    horizon: str
    as_of: str
    buckets: list[HistogramBucket]
    stats: HistogramStats
    computed_at: str


class VolTermPoint(BaseModel):
    label: str
    days: int
    std_pct: float


class VolTermStructureResponse(BaseModel):
    symbol: str
    as_of: str
    points: list[VolTermPoint]
    computed_at: str


class CrossVolPoint(BaseModel):
    week_date: str
    cross_vol_pct: float
    cross_mean_pct: float


class CrossVolResponse(BaseModel):
    as_of: str
    data: list[CrossVolPoint]
    computed_at: str


class RiskAdjPoint(BaseModel):
    rank: int
    symbol: str
    ret: float
    std: float
    score: float


class RiskAdjResponse(BaseModel):
    horizon: str
    as_of: str
    data: list[RiskAdjPoint]
    computed_at: str


class CalendarPoint(BaseModel):
    date: str
    ret_pct: float


class CalendarResponse(BaseModel):
    symbol: str
    year: int
    data: list[CalendarPoint]
    computed_at: str
