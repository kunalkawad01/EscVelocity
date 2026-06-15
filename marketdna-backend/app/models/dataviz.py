"""Pydantic models for DataViz returns endpoints."""
from pydantic import BaseModel


class ReturnBar(BaseModel):
    symbol: str
    value: float


class ReturnSnapshotStats(BaseModel):
    n_symbols: int
    n_positive: int
    n_negative: int
    avg: float
    median: float
    max_val: float
    min_val: float


class ReturnSnapshotResponse(BaseModel):
    horizon: str
    as_of: str
    winners: list[ReturnBar]
    losers: list[ReturnBar]
    stats: ReturnSnapshotStats
    computed_at: str


class ReturnHistoryPoint(BaseModel):
    date: str
    value: float


class ReturnHistoryResponse(BaseModel):
    symbol: str
    metric: str
    data: list[ReturnHistoryPoint]


class ScatterPoint(BaseModel):
    symbol: str
    ret: float
    std: float


class ScatterStats(BaseModel):
    n_symbols: int
    median_ret: float
    median_std: float
    n_high_ret_low_vol: int    # top-right quadrant: ideal
    n_high_ret_high_vol: int   # bottom-right: momentum
    n_low_ret_low_vol: int     # top-left: defensive
    n_low_ret_high_vol: int    # bottom-left: avoid


class ScatterResponse(BaseModel):
    horizon: str
    ret_col: str
    std_col: str
    as_of: str
    points: list[ScatterPoint]
    stats: ScatterStats
    computed_at: str


class Above200WeeklyPoint(BaseModel):
    week_date: str
    n_above_200: int
    total_symbols: int
    pct_above_200: float


class Above200WeeklyResponse(BaseModel):
    as_of: str
    n_symbols: int
    data: list[Above200WeeklyPoint]
    computed_at: str
