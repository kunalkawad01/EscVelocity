from __future__ import annotations
from pydantic import BaseModel
from typing import Any


class IntelligenceResponse(BaseModel):
    company: str
    ticker: str
    tagline: str
    what_they_do: str
    sector: str
    industry: str
    sub_industry: str
    industry_keywords: list[str]
    supply_chain: list[dict[str, str]]
    company_position_in_sc: str
    sc_risks: list[dict[str, str]]
    client_types: list[dict[str, Any]]
    client_concentration: str
    client_concentration_note: str
    top_clients_examples: list[str]
    market_leader: bool
    market_rank: str
    market_share_pct: float
    main_competitors: list[dict[str, Any]]
    porter: dict[str, dict[str, Any]]
    sector_growing: bool
    sector_cagr_pct: float
    sector_growth_drivers: list[str]
    sector_stage: str
    margins: dict[str, float]
    tailwinds: list[str]
    headwinds: list[str]
    predictors: list[dict[str, str]]
    _cache: str = "miss"

    model_config = {"populate_by_name": True}


class LiveQuoteResponse(BaseModel):
    ticker: str
    last_price: float | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float | None = None
    net_change: float | None = None
    pct_change: float | None = None
    volume: int | None = None
    avg_price: float | None = None
    oi: int | None = None
    oi_day_high: int | None = None
    oi_day_low: int | None = None
    buy_qty: int | None = None
    sell_qty: int | None = None
    upper_circuit: float | None = None
    lower_circuit: float | None = None
    bid: float | None = None
    ask: float | None = None


class FundamentalsResponse(BaseModel):
    ticker: str
    high_52w: float | None = None
    low_52w: float | None = None
    avg_vol: int | None = None
    last_close: float | None = None
    ret_1y_pct: float | None = None
    realised_vol_pct: float | None = None
    trading_days_1y: int | None = None
    error: str | None = None


class CacheStatusResponse(BaseModel):
    ticker: str
    cached: bool
    fresh: bool = False
    fetched_at: str | None = None
