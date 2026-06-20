"""Pydantic models for Options OI Analysis."""
from typing import Optional
from pydantic import BaseModel


class StrikeData(BaseModel):
    strike: float
    ce_oi: int
    pe_oi: int
    ce_oi_change: Optional[int] = None
    pe_oi_change: Optional[int] = None
    ce_volume: int
    pe_volume: int
    ce_iv: Optional[float] = None
    pe_iv: Optional[float] = None
    ce_ltp: float
    pe_ltp: float
    pcr: Optional[float] = None  # pe_oi / ce_oi for this strike


class MaxPainPoint(BaseModel):
    strike: float
    total_pain: float  # total option-buyer payout if expiry at this strike


class OIAnalysis(BaseModel):
    symbol: str
    date: str
    expiry: str
    spot: float
    atm_strike: float
    ce_wall: float   # highest CE OI strike (resistance)
    pe_wall: float   # highest PE OI strike (support)
    max_pain: float
    pcr: float       # total PE OI / total CE OI
    total_ce_oi: int
    total_pe_oi: int
    atm_iv: Optional[float] = None  # average of ATM CE + PE IV
    strikes: list[StrikeData]
    max_pain_curve: list[MaxPainPoint]
    futures_ltp: Optional[float] = None
    basis_pct: Optional[float] = None


class OIBuildupItem(BaseModel):
    symbol: str
    spot: float
    expiry: str
    pcr: float
    max_pain: Optional[float] = None
    max_pain_distance_pct: Optional[float] = None  # (max_pain - spot)/spot * 100
    ce_wall: float
    pe_wall: float
    total_ce_oi: int
    total_pe_oi: int
    ce_wall_oi_change: Optional[int] = None   # sum of CE OI change for strikes (0, ce_wall]
    pe_wall_oi_change: Optional[int] = None   # sum of PE OI change for strikes (0, pe_wall]
    signal: str       # "Bullish Build-up" | "Bearish Build-up" | "Short Covering" | "Long Unwinding" | "Aggressive Long Build" | "Aggressive Short Build" | "Neutral"
    signal_color: str  # hex color
    atm_iv: Optional[float] = None
    basis_pct: Optional[float] = None
    futures_ltp: Optional[float] = None
    futures_chg_pct: Optional[float] = None  # (today_ltp - yesterday_ltp) / yesterday_ltp * 100


class OIScannerResponse(BaseModel):
    date: str
    symbols: list[OIBuildupItem]


class EMHistoryRow(BaseModel):
    date: str
    spot: float
    atm_strike: float
    expiry: str
    dte: int
    ce_ltp: float
    pe_ltp: float
    futures_ltp: Optional[float]
    futures_chg_pct: Optional[float]
    straddle_premium: float
    monthly_em: float
    lower_bound: float
    upper_bound: float
    ce_wall: float
    pe_wall: float
    lower_above_pe_wall: bool   # (spot - EM) > PE wall — floor above put support
    upper_above_ce_wall: bool   # (spot + EM) > CE wall — ceiling beyond call resistance
    ce_direction: str   # "↑" | "↓" | "—"
    pe_direction: str
    futures_direction: str
    signal: str
    signal_color: str


class EMScanRow(BaseModel):
    symbol: str
    spot: float
    futures_ltp: Optional[float]
    futures_chg_pct: Optional[float]
    straddle_premium: float
    ce_ltp: float
    pe_ltp: float
    monthly_em: float
    lower_bound: float
    upper_bound: float
    ce_wall: float
    pe_wall: float
    lower_above_pe_wall: bool
    upper_above_ce_wall: bool
    ce_direction: str
    pe_direction: str
    futures_direction: str
    signal: str
    signal_color: str
    atm_strike: float
    expiry: str
    dte: int
    days_in_series: int          # total trading days with ingested data
    history: list[EMHistoryRow]  # previous days, newest first


class EMScanResponse(BaseModel):
    date: str
    rows: list[EMScanRow]


class ExpectedMovePoint(BaseModel):
    date: str
    spot: float
    atm_strike: float
    expiry: str
    dte: int             # business days to expiry
    straddle_premium: float   # ATM CE LTP + ATM PE LTP
    ce_ltp: float
    pe_ltp: float
    daily_em: float      # straddle × sqrt(1 / DTE)
    weekly_em: float     # straddle × sqrt(5 / DTE)
    monthly_em: float    # straddle (= full expiry expected move)
    daily_em_pct: float  # daily_em / spot × 100
    weekly_em_pct: float
    monthly_em_pct: float


class ExpectedMoveHistory(BaseModel):
    symbol: str
    history: list[ExpectedMovePoint]
