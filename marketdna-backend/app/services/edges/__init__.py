"""Edge Decay Observatory — registry of measurable edges.

Each entry maps an edge key to its `measure(window_start, window_end_cap, universe)`
callable. Adding an edge = one module + one line here.

Ranking edges (shared decile protocol in ranking.py): momentum_12_1, bb_meanrev, low_vol.
Event edges (delivery signal protocol in delivery.py): delivery_accumulation,
delivery_distribution.
"""
from __future__ import annotations

from typing import Callable, Optional
from datetime import date

from app.services.edges.base import EdgeMeasurement, METHODOLOGY_VERSION  # noqa: F401
from app.services.edges import bb_meanrev, delivery, low_vol, momentum

MeasureFn = Callable[[date, date, str], Optional[EdgeMeasurement]]

REGISTRY: dict[str, MeasureFn] = {
    momentum.KEY: momentum.measure,
    bb_meanrev.KEY: bb_meanrev.measure,
    low_vol.KEY: low_vol.measure,
    delivery.KEY: delivery.measure,
    delivery.KEY_DIST: delivery.measure_distribution,
}

# Portfolio-builder rule fields that lean on a measured edge. Used by the builder to
# badge rules whose underlying edge is FADING/DEAD ("this rule uses a dying edge").
# Only fields with a direct, honest mapping are listed — no stretches.
FIELD_EDGE_MAP: dict[str, str] = {
    # momentum family -> momentum_12_1
    "mom_score": momentum.KEY, "mom_rank": momentum.KEY,
    "ret_12m": momentum.KEY, "ret_12m_rank": momentum.KEY,
    "ret_6m": momentum.KEY, "ret_6m_rank": momentum.KEY,
    # short-term reversal family -> bb_meanrev
    "z20": bb_meanrev.KEY, "pctb": bb_meanrev.KEY, "rsi14": bb_meanrev.KEY,
    # volatility-ranking family -> low_vol
    "atr_pct_rank": low_vol.KEY, "atr_pctile": low_vol.KEY,
}

# Display metadata for the Observatory API/page.
EDGE_META: dict[str, dict[str, str]] = {
    momentum.KEY: {"label": momentum.LABEL, "kind": "ranking",
                   "blurb": "Do past 12-month winners keep outperforming?"},
    bb_meanrev.KEY: {"label": bb_meanrev.LABEL, "kind": "ranking",
                     "blurb": "Do short-term oversold stocks bounce more than overbought ones?"},
    low_vol.KEY: {"label": low_vol.LABEL, "kind": "ranking",
                  "blurb": "Do calm stocks earn more than wild ones (the low-vol anomaly)?"},
    delivery.KEY: {"label": delivery.LABEL, "kind": "event",
                   "blurb": "Volume surge + high delivery + up candle — does smart-money buying predict gains?"},
    delivery.KEY_DIST: {"label": delivery.LABEL_DIST, "kind": "event",
                        "blurb": "Volume surge + high delivery + down candle — does smart-money selling predict drops?"},
}
