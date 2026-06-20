from pydantic import BaseModel


class BreakoutRow(BaseModel):
    symbol: str
    live_price: float
    prev_close: float
    change_pct: float
    high_1d:   float | None
    high_2d:   float | None
    high_3d:   float | None
    high_4d:   float | None
    high_5d:   float | None
    high_10d:  float | None
    sma20:     float | None
    sma50:     float | None
    sma200:    float | None
    crossed_1d:   bool
    crossed_2d:   bool
    crossed_3d:   bool
    crossed_4d:   bool
    crossed_5d:   bool
    crossed_10d:  bool
    above_sma20:  bool
    above_sma50:  bool
    above_sma200: bool
    score: int
    closes_20: list[float]
    day_spark: list[float]


class BreakoutScanResponse(BaseModel):
    as_of:     str
    count:     int
    kite_live: bool
    rows:      list[BreakoutRow]
