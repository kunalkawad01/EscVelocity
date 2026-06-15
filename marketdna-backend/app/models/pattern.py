"""Pydantic models for Pattern DNA Intelligence."""
from pydantic import BaseModel


class PatternDetection(BaseModel):
    symbol: str
    pattern: str
    category: str
    confidence: int
    stage: str
    days_forming: int
    breakout_level: float | None
    support_level: float | None
    resistance_level: float | None
    risk_reward: str
    detected_date: str


class PatternDNAEntry(BaseModel):
    pattern: str
    category: str
    occurrences: int
    success_rate: float
    avg_fwd_21d: float
    avg_fwd_63d: float
    dna_score: int
    avg_confidence: float = 0.0


class PatternDNAResponse(BaseModel):
    symbol: str
    dna: list[PatternDNAEntry]
    best_pattern: str | None
    best_score: int


class ScannerItem(BaseModel):
    symbol: str
    pattern: str
    category: str
    confidence: int
    stage: str
    days_forming: int
    breakout_level: float | None


class PatternScannerResponse(BaseModel):
    items: list[ScannerItem]
    scanned_at: str


class ScreenerItem(BaseModel):
    symbol: str
    dna_score: int
    success_rate: float
    avg_fwd_21d: float
    avg_fwd_63d: float
    occurrences: int
    avg_confidence: float = 0.0


class PatternScreenerResponse(BaseModel):
    pattern: str
    items: list[ScreenerItem]


class ConfirmedFormingItem(BaseModel):
    symbol: str
    pattern: str
    category: str
    confidence: int
    stage: str
    days_forming: int
    breakout_level: float | None
    support_level: float | None
    risk_reward: str
    dna_score: int
    success_rate: float
    avg_fwd_21d: float
    avg_fwd_63d: float
    occurrences: int


class ConfirmedFormingResponse(BaseModel):
    items: list[ConfirmedFormingItem]
    scanned_at: str
    total_scanned: int


# ── Feature 1: Pattern History Timeline ──────────────────────────────────────

class PatternHistoryItem(BaseModel):
    date: str
    pattern: str
    category: str
    fwd_21d: float | None
    fwd_63d: float | None
    outcome: str  # "Win", "Loss", "Pending"


class PatternHistoryResponse(BaseModel):
    symbol: str
    timeframe: str
    items: list[PatternHistoryItem]


# ── Feature 2: Pattern Breakout Tracker ──────────────────────────────────────

class BreakoutTrackerItem(BaseModel):
    symbol: str
    pattern: str
    category: str
    detected_date: str
    days_since: int
    breakout_level: float | None
    support_level: float | None
    entry_price: float
    current_price: float
    change_pct: float
    status: str  # "Confirmed", "Failed", "Forming"


class BreakoutTrackerResponse(BaseModel):
    items: list[BreakoutTrackerItem]
    scanned_at: str
    days_back: int


# ── Feature 3: Market Pattern Heatmap ────────────────────────────────────────

class HeatmapCell(BaseModel):
    pattern: str
    category: str
    count: int
    avg_confidence: float
    symbols: list[str]


class PatternHeatmapResponse(BaseModel):
    cells: list[HeatmapCell]
    total_symbols: int
    patterns_active: int
    scanned_at: str


# ── Feature 4: Regime-Conditioned DNA ────────────────────────────────────────

class RegimeBucket(BaseModel):
    n: int
    success_rate: float
    avg_ret_21d: float


class RegimeDNAEntry(BaseModel):
    pattern: str
    category: str
    bull: RegimeBucket
    sideways: RegimeBucket
    bear: RegimeBucket
    best_regime: str  # which regime has highest success_rate


class RegimeDNAResponse(BaseModel):
    symbol: str
    entries: list[RegimeDNAEntry]


# ── Feature 5: Pattern Failure Analysis ──────────────────────────────────────

class PatternFailureItem(BaseModel):
    symbol: str
    failure_rate: float
    occurrences: int
    avg_fwd_21d: float
    avg_loss: float  # average of negative returns only
    dna_score: int


class PatternFailureResponse(BaseModel):
    pattern: str
    items: list[PatternFailureItem]
