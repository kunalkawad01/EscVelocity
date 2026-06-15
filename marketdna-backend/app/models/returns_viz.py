"""Pydantic models for Returns Visualization bubble chart."""
from pydantic import BaseModel


class BubblePoint(BaseModel):
    symbol: str
    ret: float    # return % at selected horizon (x-axis)
    std: float    # rolling std % at selected horizon (y-axis)
    z: float      # bubble size = max(0.5, abs(ret))


class BubbleScatterResponse(BaseModel):
    horizon: str               # e.g. "20d"
    as_of: str                 # YYYY-MM-DD
    points: list[BubblePoint]
    n_symbols: int
    avg_return: float
    pct_positive: float        # % of symbols with ret > 0
    avg_std: float
    computed_at: str


class AvailableDatesResponse(BaseModel):
    dates: list[str]           # YYYY-MM-DD strings, DESC
    latest: str
