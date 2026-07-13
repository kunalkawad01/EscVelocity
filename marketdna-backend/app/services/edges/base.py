"""
Edge Decay Observatory — shared contract and math helpers.

An *edge* is a measurable market anomaly (momentum spread, delivery-signal excess
return...). Each edge module exposes a `measure(window_start, window_end_cap, universe)`
function returning an `EdgeMeasurement` (or None when the window has insufficient data).

Design rules (non-negotiable):
  * Deterministic — same window in, identical numbers out (bootstrap uses a fixed seed).
  * Pure math separated from I/O — `_measure_from_*` core functions take arrays/frames so
    they are unit-testable on synthetic data; `measure()` only fetches and delegates.
  * Forward-return truncation — a signal needs 21 trading days of future to be scored.
    Cores must never score a formation bar without a full forward window.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np

FWD_BARS = 21          # forward-return horizon (trading days) — the scoring window
BOOT_N = 1000          # bootstrap resamples for the CI
BOOT_SEED = 42         # fixed seed — determinism (Principle 3)
METHODOLOGY_VERSION = "v1"


@dataclass
class EdgeMeasurement:
    """One reading of one edge over one window. All return figures are percentages."""
    edge_key: str
    edge_ann_pct: Optional[float]      # annualized signal-vs-universe excess return, %
    hit_rate: Optional[float]          # % of formation dates/events with positive excess
    decile_spread: Optional[float]     # top − bottom decile forward return, % per period
                                       # (None for event-based edges with no deciles)
    n_signals: int                     # top-decile stock-months, or signal events
    ci_low: Optional[float]            # bootstrap 95% CI on the primary edge stat, %
    ci_high: Optional[float]
    window_start: str                  # first formation date actually used (ISO)
    window_end: str                    # last formation date actually used (ISO)
    extras: dict[str, Any] = field(default_factory=dict)


def bootstrap_ci(values: np.ndarray, n_boot: int = BOOT_N,
                 seed: int = BOOT_SEED) -> tuple[Optional[float], Optional[float]]:
    """Deterministic percentile-bootstrap 95% CI on the mean of `values`.

    Returns (None, None) when there are too few observations to resample meaningfully.
    """
    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]
    if len(values) < 5:
        return None, None
    rng = np.random.RandomState(seed)
    idx = rng.randint(0, len(values), size=(n_boot, len(values)))
    means = values[idx].mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))
