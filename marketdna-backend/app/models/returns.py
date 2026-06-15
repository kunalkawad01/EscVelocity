"""Pydantic models for Returns Scatter endpoint."""
from pydantic import BaseModel


class ReturnDataPoint(BaseModel):
    symbol: str
    return_pct: float
    std_dev: float
    days: int


class ReturnScatterResult(BaseModel):
    period: str
    as_of: str
    data: list[ReturnDataPoint]


class BubbleItem(BaseModel):
    symbol: str
    return_pct: float
    std_dev: float
    abs_return: float
