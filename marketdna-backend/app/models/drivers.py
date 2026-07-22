"""Pydantic models for the Stock Drivers content layer.

Stock Drivers are curated fundamental context per symbol — the forces
(demand cycles, policy, order flow, input costs, ownership) that explain
why a stock moves. Content is authored offline as YAML files in
``content/drivers/<SYMBOL>.yaml`` and validated against these models at
server startup. See ``fundamental.md`` at repo root for the full feature plan.
"""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field

DriverCategory = Literal[
    "demand",
    "policy",
    "orders",
    "input_costs",
    "competition",
    "ownership",
    "catalyst",
]

DriverWeight = Literal["primary", "secondary", "background"]

ReviewCadence = Literal["monthly", "quarterly", "half_yearly", "yearly"]


class DriverEvent(BaseModel):
    """A dated event tied to a driver — rendered as a chart annotation.

    ``event_date`` accepts partial precision as a string ("2026-02" when the
    exact day is unknown, "2026-02-17" when known) so approximate but honest
    dating is possible. Chart overlay resolves partial dates to month-start.
    """

    event_date: str = Field(
        ...,
        description="Event date: 'YYYY-MM-DD' or 'YYYY-MM' if day unknown.",
        pattern=r"^\d{4}-\d{2}(-\d{2})?$",
    )
    label: str = Field(..., description="Short annotation label for the chart.")
    observed_move: Optional[str] = Field(
        default=None,
        description="Observed price reaction, e.g. '~-10%' or '+rally'.",
    )


class LeadingIndicator(BaseModel):
    """One observable, publicly checkable series or event type that leads a driver."""

    name: str = Field(..., description="Named indicator, e.g. 'ACT Class 8 net orders'.")
    source: str = Field(..., description="Where to check it (publication, filing, call).")
    cadence: str = Field(..., description="Release cadence, e.g. 'monthly', 'quarterly'.")
    lead: str = Field(
        ...,
        description="Lead-lag relationship, e.g. '~1-2 quarters ahead of orders'.",
    )


class DriverForecast(BaseModel):
    """How to see a driver coming — observable lead-lag logic, never a prediction.

    For event-driven drivers that are genuinely unforecastable, ``how`` states
    that explicitly and ``leading_indicators`` lists the earliest visible
    footprint to track instead.
    """

    how: str = Field(..., description="Causal lead-lag logic, or 'Not forecastable — event-driven' plus what to track.")
    leading_indicators: list[LeadingIndicator] = Field(default_factory=list)
    rule_of_thumb: Optional[str] = Field(
        default=None,
        description="Falsifiable threshold heuristic, e.g. 'orders > 30k/month = cycle peaking'.",
    )


LiveMetricKey = Literal["atm_iv_percentile", "futures_basis"]


class DriverLive(BaseModel):
    """Step-6 wiring: binds a driver card to a live metric computed from our own data.

    ``metric`` names a key in the drivers_service live-metric registry; the
    resolved value arrives in ``StockDrivers.live_values`` at request time.
    """

    metric: LiveMetricKey
    label: str = Field(..., description="How the metric relates to this driver, one line.")


class LiveValue(BaseModel):
    """A resolved live metric — computed at request time, never stored in YAML."""

    metric: LiveMetricKey
    value: float
    unit: str = Field(..., description="Display unit, e.g. '%', 'pctile'.")
    detail: str = Field(..., description="One-line reading, e.g. 'ATM IV 32.4% — 78th percentile of 90d'.")
    as_of: str = Field(..., description="Data date the value was computed from.")


class Driver(BaseModel):
    """A single fundamental driver of a stock, in three layers:

    ``narrative`` (analyst-grade), ``simple_english`` (causal chain for a
    non-finance reader), ``forecast`` (how to see it coming).
    """

    title: str
    category: DriverCategory
    weight: DriverWeight = "secondary"
    narrative: str = Field(..., description="Analyst-grade description of the driver.")
    simple_english: str = Field(
        ...,
        description="Causal chain in plain language — why this makes the stock move.",
    )
    forecast: DriverForecast
    events: list[DriverEvent] = Field(default_factory=list)
    watch: Optional[str] = Field(
        default=None, description="The single datapoint to monitor, one line."
    )
    direction: Optional[str] = Field(
        default=None, description="Which way the driver cuts, e.g. 'Higher orders → positive'."
    )
    verify_note: Optional[str] = Field(
        default=None,
        description="Unresolved factual uncertainty, surfaced verbatim in the UI.",
    )
    as_of: Optional[str] = Field(
        default=None,
        description="Point-in-time stamp for dated facts, e.g. '2026-Q1' for shareholding.",
    )
    live: Optional[DriverLive] = Field(
        default=None,
        description="Optional live-metric wiring (step 6) — resolved into live_values at request time.",
    )


class SourceDocument(BaseModel):
    """A primary document consulted while authoring the dossier.

    Investor presentations, annual reports, and concall transcripts are the
    canonical sources — every dossier records which editions it drew from so
    the refresh pass knows what is already incorporated.
    """

    doc_type: Literal[
        "annual_report", "investor_presentation", "concall_transcript", "filing", "other"
    ]
    title: str = Field(..., description="e.g. 'Bharat Forge Annual Report FY25'.")
    period: str = Field(..., description="Period covered, e.g. 'FY25' or 'Q4 FY26'.")
    url: Optional[str] = Field(default=None, description="Link to the document if public.")


class StockDrivers(BaseModel):
    """A full driver dossier for one symbol — one YAML file in content/drivers/."""

    symbol: str
    company: str
    sector: str
    last_reviewed: date = Field(
        ..., description="Date of last human review. Drives the staleness badge — never hidden."
    )
    review_cadence: ReviewCadence = "quarterly"
    sources: list[SourceDocument] = Field(
        default_factory=list,
        description="Primary documents (annual report, investor PPT, concalls) this dossier draws from.",
    )
    drivers: list[Driver] = Field(..., min_length=1)
    live_values: dict[str, LiveValue] = Field(
        default_factory=dict,
        description="Resolved live metrics keyed by metric name — populated at request time, never in YAML.",
    )


class DriversCoverage(BaseModel):
    """Response for GET /api/drivers/coverage — which symbols have dossiers.

    ``errors`` lists dossier files that failed validation at load time (one
    entry per bad file) so authoring mistakes are visible, not silent.
    """

    symbols: list[str]
    count: int
    errors: list[str] = Field(default_factory=list)
