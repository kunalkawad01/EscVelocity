"""Pydantic models for Druckenmiller ROC² signal engine."""
from pydantic import BaseModel


class ROC2HistoryPoint(BaseModel):
    date: str
    close: float
    # Intermediate (primary / phase source)
    roc: float | None = None
    roc2: float | None = None
    # Short timeframe
    roc_short: float | None = None
    roc2_short: float | None = None
    # Long timeframe
    roc_long: float | None = None
    roc2_long: float | None = None
    vol_roc2: float | None = None
    phase: str


class ROC2StockResult(BaseModel):
    symbol: str
    date: str
    close: float
    # Current values — three timeframes (short/intermediate/long)
    roc_short: float | None        # 21-day ROC
    roc_intermediate: float | None # 63-day ROC
    roc_long: float | None         # 126-day ROC
    roc2_short: float | None       # delta of short ROC over 5 bars
    roc2_intermediate: float | None  # delta of intermediate ROC over 21 bars
    roc2_long: float | None        # delta of long ROC over 42 bars
    vol_roc2: float | None         # volume ROC² (same engine on volume)
    phase: str                     # current phase label
    lead_count: int                # 0–3: timeframes where roc2 > 0
    composite: float               # –100 to +100 composite momentum score
    history: list[ROC2HistoryPoint]  # last 252 bars of intermediate roc/roc2
    computed_at: str


class ROC2ScanItem(BaseModel):
    symbol: str
    close: float
    roc_intermediate: float | None
    roc2_intermediate: float | None
    vol_roc2: float | None
    phase: str
    lead_count: int
    composite: float
    sparkline: list[float]  # last 30 close prices for mini chart


class ROC2ScanResult(BaseModel):
    date: str
    total: int
    early_bottom_count: int
    strong_uptrend_count: int
    top_inflection_count: int
    strong_downtrend_count: int
    stocks: list[ROC2ScanItem]
    computed_at: str
