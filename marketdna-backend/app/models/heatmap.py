"""Pydantic models for Sector Heatmap response."""
from __future__ import annotations
from typing import Dict, List
from pydantic import BaseModel


class Week52(BaseModel):
    low: float
    high: float
    current: float


class StockHeatmapEntry(BaseModel):
    symbol: str
    name: str
    is_fno: bool
    returns: Dict[str, float]
    series: Dict[str, List[float]]
    week52: Week52
    rs_vs_nifty: Dict[str, float]


class SectorHeatmapEntry(BaseModel):
    name: str
    color: str
    momentum_score: float
    breadth: Dict[str, float]
    returns: Dict[str, float]
    series: Dict[str, List[float]]
    stocks: List[StockHeatmapEntry]


class SectorHeatmapResponse(BaseModel):
    universe: str
    as_of: str
    nifty_returns: Dict[str, float]
    sectors: List[SectorHeatmapEntry]
