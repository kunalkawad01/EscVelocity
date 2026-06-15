"""Pydantic models for DataViz breadth/factor analytics endpoints."""
from pydantic import BaseModel


class MultiSMAPoint(BaseModel):
    week_date: str
    total_symbols: int
    pct_above_20: float
    pct_above_50: float
    pct_above_200: float


class MultiSMAResponse(BaseModel):
    as_of: str
    data: list[MultiSMAPoint]
    computed_at: str


class ADPoint(BaseModel):
    week_date: str
    advancers: int
    decliners: int
    net: int
    cumulative: int


class ADResponse(BaseModel):
    as_of: str
    data: list[ADPoint]
    computed_at: str


class CorrMatrixResponse(BaseModel):
    as_of: str
    symbols: list[str]
    matrix: list[list[float]]
    computed_at: str


class AlphaBetaPoint(BaseModel):
    symbol: str
    alpha: float
    beta: float
    r_squared: float


class AlphaBetaResponse(BaseModel):
    as_of: str
    horizon: str
    lookback: int
    points: list[AlphaBetaPoint]
    computed_at: str
