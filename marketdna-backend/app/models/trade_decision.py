"""Pydantic models for Trade Decision Agent responses."""
from typing import Optional, Literal
from pydantic import BaseModel


Verdict        = Literal["STRONG GO", "GO", "WEAK GO", "NO-GO", "STRONG NO-GO"]
Direction      = Literal["LONG", "SHORT"]
InstrumentType = Literal["EQUITY", "OPTIONS", "FUTURES"]


class MarketContextOut(BaseModel):
    regime_score:  float
    breadth_score: float
    vix_level:     Optional[float] = None
    posture:       str              # BULL | BEAR | SIDEWAYS
    market_score:  float
    key_insight:   str


class InstrumentAnalysisOut(BaseModel):
    instrument_score: float
    dna_score:        Optional[float] = None
    regime_score:     Optional[float] = None
    rs_score:         Optional[float] = None
    iv_rank:          Optional[float] = None
    basis_premium:    Optional[float] = None
    oi_trend:         Optional[str]   = None
    delivery_signal:  Optional[str]   = None
    key_metrics:      dict            = {}
    key_insight:      str             = ""


class SignalConvergenceOut(BaseModel):
    alignment_score:       float
    confirming_signals:    list[str] = []
    contradicting_signals: list[str] = []
    neutral_signals:       list[str] = []
    pattern_active:        Optional[str] = None
    key_insight:           str           = ""


class RiskCalibrationOut(BaseModel):
    risk_score:        float
    risk_reward_ratio: Optional[float] = None
    entry_low:         Optional[float] = None
    entry_high:        Optional[float] = None
    stop_loss:         Optional[float] = None
    target_1:          Optional[float] = None
    target_2:          Optional[float] = None
    position_size_pct: Optional[float] = None
    max_risk_pct:      Optional[float] = None
    atr_20:            Optional[float] = None
    key_insight:       str             = ""


class HistoricalContextOut(BaseModel):
    historical_score:        float
    win_rate_similar:        Optional[float] = None
    comparable_setups_count: int             = 0
    avg_gain_on_wins:        Optional[float] = None
    avg_loss_on_losses:      Optional[float] = None
    regime_win_rate:         Optional[float] = None
    key_insight:             str             = ""


class TradeBriefResponse(BaseModel):
    # Identity
    symbol:          str
    direction:       Direction
    instrument_type: InstrumentType
    entry_price:     Optional[float] = None

    # Sub-agent outputs
    market_context:      MarketContextOut
    instrument_analysis: InstrumentAnalysisOut
    signal_convergence:  SignalConvergenceOut
    risk_calibration:    RiskCalibrationOut
    historical_context:  HistoricalContextOut

    # Verdict
    confidence:      float
    verdict:         Verdict
    verdict_color:   str
    narrative:       str
    trade_checklist: list[str] = []


class ScanSetupOut(BaseModel):
    """Compact setup for the scan panel (list view)."""
    symbol:          str
    direction:       Direction
    instrument_type: InstrumentType
    confidence:      float
    verdict:         Verdict
    verdict_color:   str
    regime_score:    float
    dna_score:       Optional[float] = None
    rs_score:        Optional[float] = None
    iv_rank:         Optional[float] = None
    signal_count:    int
    one_liner:       str


class ScanRequest(BaseModel):
    instrument_types: list[InstrumentType] = ["EQUITY", "OPTIONS", "FUTURES"]
    min_confidence:   float                 = 55.0
    max_results:      int                   = 20


class ScanResponse(BaseModel):
    setups: list[ScanSetupOut]
    total_scanned:   int
    generated_at:    str


class AnalyzeRequest(BaseModel):
    symbol:          str
    direction:       Direction
    instrument_type: InstrumentType
    entry_price:     Optional[float] = None
    account_size:    Optional[float] = None
