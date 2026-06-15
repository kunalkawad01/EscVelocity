"""Pydantic models for the Pattern DNA Validation Report."""
from pydantic import BaseModel


class OOSSplitResult(BaseModel):
    pattern: str
    n_symbols: int              # stocks with ≥5 years of history
    is_n: int                   # in-sample qualified detections
    oos_n: int                  # out-of-sample qualified detections
    is_success_rate: float      # % of IS detections that succeeded
    oos_success_rate: float     # % of OOS detections that succeeded
    is_avg_ret_21d: float       # avg 21-day forward return in IS period
    oos_avg_ret_21d: float      # avg 21-day forward return in OOS period
    degradation_pct: float      # (IS_SR - OOS_SR) / IS_SR × 100
    passes: bool                # OOS degradation < 20%


class DecileRow(BaseModel):
    rank: str                   # "Q1 (Best DNA)" … "Q5 (Worst DNA)"
    n_symbols: int
    avg_dna_score: float        # mean IS DNA score in this group
    oos_avg_ret_21d: float      # mean OOS 21-day return when pattern detected
    n_detections: int           # OOS detections in this group


class DecileResult(BaseModel):
    pattern: str
    rows: list[DecileRow]
    spread_pct: float           # Q1 return − Q5 return
    monotonic: bool             # does return improve from Q5 → Q1?
    passes: bool                # spread > 2% and monotonic


class ConfBin(BaseModel):
    label: str                  # "No volume (0)", "Partial (1)", "Full (2+)"
    n: int
    success_rate: float
    avg_ret_21d: float


class CalibrationResult(BaseModel):
    pattern: str
    bins: list[ConfBin]
    monotonic: bool             # does success rate rise with volume confirmation?
    passes: bool                # monotonic = True and spread between full/none > 5%


class ValidationSummary(BaseModel):
    pattern: str
    step2_oos: bool | None
    step3_decile: bool | None
    step4_calibration: bool | None
    verdict: str                # "VALIDATED" | "PARTIAL" | "UNVALIDATED" | "INSUFFICIENT_DATA"


class ValidationReport(BaseModel):
    generated_at: str
    is_bars: int                # 756 (~3 years)
    oos_bars: int               # 504 (~2 years)
    min_occurrences: int        # 12
    n_symbols_total: int
    n_symbols_sufficient: int   # stocks with ≥5 years history

    oos_results: list[OOSSplitResult]
    decile_results: list[DecileResult]
    calibration_results: list[CalibrationResult]
    summary: list[ValidationSummary]
