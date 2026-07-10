"""Pydantic models for the F&O Live Tactical Dashboard (/fno-tactical).

Response shapes for the four dashboard zones:
  Zone 0 → BreadthVerdict            (should-I-trade-at-all gate)
  Zone 1 → FnoUniverseResponse       (OI positioning scatter)
  Zone 2 → NormalizedSeries          (rebased 9:15 relative-strength lines)
  Zone 3 → OptionChainResponse       (ATM±3 ladder) + StrikeChartResponse (FUT/CE/PE)
Plus MarketState (the closed/pre-open/live/holiday gate that guards the whole page).
"""
from typing import Optional
from pydantic import BaseModel


# ── Market-state gate ─────────────────────────────────────────────────────────
class MarketState(BaseModel):
    state: str            # PRE_PRECOMPUTE | PRE_OPEN | LIVE | CLOSED | HOLIDAY
    session_date: str     # YYYY-MM-DD of the frame being served
    label: str            # human-readable pill text, e.g. "CLOSED — showing 09 Jul close"
    is_live: bool
    server_time: str      # HH:MM:SS IST


# ── Signal grade (server-side; strategy.md quadrant→grade table) ──────────────
class SignalGrade(BaseModel):
    direction: str        # long | short | none
    grade: str            # A | B | NONE
    size: str             # full | half | none
    reasons: list[str]


# ── Zone 1 — per-symbol positioning row ───────────────────────────────────────
class FnoUniverseRow(BaseModel):
    symbol: str
    sector: Optional[str] = None
    ltp: float
    prev_close: float
    open_0915: float
    ret_pct: float                    # X-axis: ltp/open_0915 - 1  (%)
    ret_per_atr: float                # Y-axis: (ltp-open_0915)/atr14
    atr_pct: Optional[float] = None
    oi: Optional[int] = None
    oi_prev_close: Optional[int] = None
    oi_chg_pct: Optional[float] = None  # bubble size (%)
    quadrant: Optional[str] = None    # LONG_BUILDUP|SHORT_COVERING|SHORT_BUILDUP|LONG_UNWINDING
    trend: str                        # UP | DOWN | NONE
    above_vwap: Optional[bool] = None
    vwap: Optional[float] = None
    rel_strength: float               # ret_pct - nifty_ret
    day_high: Optional[float] = None
    day_low: Optional[float] = None
    volume: Optional[float] = None
    liquid: bool = True
    extended: bool = False            # |ret_per_atr| > 1.5
    grade: SignalGrade


class FnoUniverseResponse(BaseModel):
    as_of: str
    state: str
    session_date: str
    data_mode: str                    # live | eod_fallback
    oi_live: bool                     # True when live futures OI was fetched
    nifty_ret: float
    rows: list[FnoUniverseRow]


# ── Zone 0 — breadth verdict ──────────────────────────────────────────────────
class BreadthVerdict(BaseModel):
    as_of: str
    state: str
    verdict: str                      # RISK_ON | RISK_OFF | NEUTRAL
    pct_above_vwap: Optional[float] = None
    adv_decl: float
    advances: int
    declines: int
    nifty_from_0915: float
    longs_enabled: bool
    shorts_enabled: bool
    rationale: str


# ── Zone 2 — normalized 9:15 lines ────────────────────────────────────────────
class NormalizedSeries(BaseModel):
    as_of: str
    state: str
    times: list[str]                  # HH:MM axis
    series: dict[str, list[float]]    # {SYMBOL|NIFTY|SECTOR: [pct...]}  rebased to 0 @09:15
    note: Optional[str] = None


# ── Zone 3 — option chain ─────────────────────────────────────────────────────
class OptionLadderRow(BaseModel):
    strike: float
    is_atm: bool
    ce_ltp: Optional[float] = None
    ce_iv: Optional[float] = None
    ce_oi: int
    pe_ltp: Optional[float] = None
    pe_iv: Optional[float] = None
    pe_oi: int
    pcr: Optional[float] = None
    oi_total: int


class OptionChainResponse(BaseModel):
    symbol: str
    is_fo: bool
    state: str
    expiry: Optional[str] = None
    spot: Optional[float] = None
    atm_strike: Optional[float] = None
    straddle: Optional[float] = None
    upper_be: Optional[float] = None
    lower_be: Optional[float] = None
    gamma_wall: Optional[float] = None
    total_pcr: Optional[float] = None
    lot_size: Optional[int] = None
    strikes: list[OptionLadderRow] = []


class ChartPoint(BaseModel):
    time: str
    value: float


class StrikeChartResponse(BaseModel):
    symbol: str
    strike: float
    expiry: str
    futures: list[ChartPoint] = []
    futures_oi: list[ChartPoint] = []
    ce: list[ChartPoint] = []
    ce_oi: list[ChartPoint] = []
    pe: list[ChartPoint] = []
    pe_oi: list[ChartPoint] = []
    futures_oi_now: int = 0
    ce_oi_now: int = 0
    pe_oi_now: int = 0
