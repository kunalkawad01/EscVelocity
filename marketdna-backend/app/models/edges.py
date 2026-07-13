"""Pydantic models for the Edge Decay Observatory API."""
from typing import Any, Optional

from pydantic import BaseModel


class EdgeLatest(BaseModel):
    period: str
    edge_ann_pct: Optional[float] = None
    hit_rate: Optional[float] = None
    decile_spread: Optional[float] = None
    n_signals: int
    ci_low: Optional[float] = None
    ci_high: Optional[float] = None


class EdgeSeriesPoint(BaseModel):
    period: str
    edge_ann_pct: Optional[float] = None
    hit_rate: Optional[float] = None
    n_signals: int
    ci_low: Optional[float] = None
    ci_high: Optional[float] = None
    is_backfilled: bool


class EdgeCard(BaseModel):
    edge_key: str
    label: str
    kind: str                              # ranking | event
    blurb: str
    n_readings: int
    status: str                            # HEALTHY | FADING | WEAK | DEAD | TOO_NOISY
    reason: str
    slope: Optional[float] = None          # edge_ann_pct change per reading (trend)
    p_value: Optional[float] = None
    latest: Optional[EdgeLatest] = None
    series: list[EdgeSeriesPoint]


class ObservatoryResponse(BaseModel):
    universe: str
    methodology_version: str
    as_of: str
    edges: list[EdgeCard]
    status_rules: dict[str, Any]


class EdgeMeasurementRow(BaseModel):
    period: str
    window_start: str
    window_end: str
    edge_ann_pct: Optional[float] = None
    hit_rate: Optional[float] = None
    decile_spread: Optional[float] = None
    n_signals: int
    ci_low: Optional[float] = None
    ci_high: Optional[float] = None
    extras: dict[str, Any]
    is_backfilled: bool
    measured_at: str


class FieldHealth(BaseModel):
    edge_key: str
    edge_label: str
    status: str
    reason: str
    latest_edge_ann_pct: Optional[float] = None


class FieldHealthResponse(BaseModel):
    fields: dict[str, FieldHealth]
    as_of: str


class EdgeReportResponse(BaseModel):
    period: str
    universe: str
    methodology_version: str
    as_of: str
    markdown: str


class EdgeHistoryResponse(BaseModel):
    edge_key: str
    label: str
    kind: str
    blurb: str
    universe: str
    methodology_version: str
    status: str
    reason: str
    slope: Optional[float] = None
    p_value: Optional[float] = None
    measurements: list[EdgeMeasurementRow]
