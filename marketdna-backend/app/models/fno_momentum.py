"""Pydantic models for the F&O Momentum Radar (/fno-momentum).

Two futures-positioning buckets — OI Gainers and Short Covering — filtered to
stocks that additionally qualify on at least one of three momentum criteria:
  BIG_MOVE_PREV  — last completed session move beyond ±5%
  TOP_SECTOR     — stock belongs to one of today's top-3 performing sectors
  GAP_0915       — 9:15 open gapped beyond ±2% vs previous close
"""
from typing import Optional
from pydantic import BaseModel


class SectorPerf(BaseModel):
    sector: str
    avg_ret: float        # mean day change % across the sector's F&O symbols
    count: int            # symbols contributing


class MomentumRow(BaseModel):
    symbol: str
    sector: Optional[str] = None
    ltp: float
    prev_close: float
    change_pct: float                 # (ltp / prev_close - 1) % — sort key
    last_session_ret: Optional[float] = None   # last completed session move %
    gap_0915_pct: Optional[float] = None       # 9:15 open vs prev close %
    oi: Optional[int] = None
    oi_chg_pct: Optional[float] = None         # futures OI change vs prior session %
    quadrant: Optional[str] = None    # LONG_BUILDUP|SHORT_COVERING|SHORT_BUILDUP|LONG_UNWINDING
    volume: Optional[float] = None
    criteria: list[str]               # subset of [BIG_MOVE_PREV, TOP_SECTOR, GAP_0915]


class MomentumThresholds(BaseModel):
    big_move_pct: float                # ±5
    gap_pct: float                     # ±2
    top_sectors_n: int                 # 3
    live_move_pct: float               # ±2 — Live Movers section gate


class FnoMomentumResponse(BaseModel):
    as_of: str
    state: str                        # PRE_PRECOMPUTE | PRE_OPEN | LIVE | CLOSED | HOLIDAY
    session_date: str
    data_mode: str                    # live | eod_fallback
    oi_live: bool
    thresholds: MomentumThresholds
    top_sectors: list[SectorPerf]
    oi_gainers: list[MomentumRow]     # futures OI up vs prior session, sorted by change_pct desc
    short_covering: list[MomentumRow] # price up + futures OI down, sorted by change_pct desc
    movers_up: list[MomentumRow]      # whole F&O universe, live change_pct ≥ live_move_pct, desc
    movers_down: list[MomentumRow]    # whole F&O universe, live change_pct ≤ -live_move_pct, asc
