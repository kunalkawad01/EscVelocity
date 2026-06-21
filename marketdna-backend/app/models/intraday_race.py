from typing import Optional
from pydantic import BaseModel


class IntradaySymbol(BaseModel):
    symbol: str
    ltp: float
    prev_close: float
    return_pct: float
    rank: int
    prev_rank: int
    atr2: float
    category: str       # "top" | "bot" | "rec" | "dec" | "neu"
    norm_return: float  # (ltp / price_at_915 - 1) * 100


class IntradayReturnsResponse(BaseModel):
    as_of: str
    market_open: bool
    data_mode: str              # "live" | "eod_fallback" | "snapshot"
    replay_source: Optional[str] = None  # "kite" | "eod" — set for snapshot mode only
    symbols: list[IntradaySymbol]


class NormHistoryResponse(BaseModel):
    price_at_915: dict[str, float]
    times: list[str]
    series: dict[str, list[float]]   # symbol → norm_return per time slot
    categories: dict[str, str]       # symbol → current category
