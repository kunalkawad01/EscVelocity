"""
Edge Decay Observatory — read layer: trend, status, and the observatory snapshot.

Reads the immutable `edge_measurements` rows (written by jobs/measure_edges.py) and
computes trend + status ON READ — statuses are derived, never stored, so the ruleset
can improve without rewriting history.

Status ruleset (documented on the page; thresholds in _CFG, versioned in git):
    TOO_NOISY  fewer than MIN_READINGS readings — not enough longitudinal data to judge
    REVIVING   significant UPTREND with the latest reading positive, even though recent
               CIs straddle zero — an edge crossing up through zero (checked before DEAD
               so a rising edge is never labeled dead on its way back)
    DEAD       the last DEAD_RUN readings all have CIs straddling zero AND a small edge
    FADING     downtrend in edge_ann_pct over the trailing TREND_WINDOW readings
               (OLS slope < 0, p < P_SIG) while the edge is still positive
    WEAK       latest CI straddles zero (edge indistinguishable from nothing right now)
    HEALTHY    otherwise — latest reading positive with CI clear of zero

Day-cached like other services; cleared via invalidate().
"""
from __future__ import annotations

import logging
import threading
from datetime import date
from typing import Any, Optional

import numpy as np

from app.db import StoreUnavailable
from app.services.edges import EDGE_META, FIELD_EDGE_MAP, METHODOLOGY_VERSION, REGISTRY
from app.services.edges import store

log = logging.getLogger(__name__)

_CFG = {
    "MIN_READINGS": 6,       # below this -> TOO_NOISY
    "TREND_WINDOW": 12,      # readings used for the decay trend
    "P_SIG": 0.10,           # slope significance for FADING
    "DEAD_RUN": 6,           # consecutive CI-straddles-zero readings -> DEAD candidate
    "DEAD_EDGE_MAX": 3.0,    # ...and |mean edge| below this (% ann) over that run
}

_cache: dict[str, tuple[str, Any]] = {}
_lock = threading.Lock()


def _today() -> str:
    return date.today().isoformat()


def invalidate() -> None:
    with _lock:
        _cache.clear()


# ── trend + status (pure) ─────────────────────────────────────────────────────
def _ols_trend(values: list[float]) -> tuple[Optional[float], Optional[float]]:
    """(slope per reading, two-sided p-value) of an OLS fit; (None, None) if too short."""
    y = np.asarray([v for v in values if v is not None], dtype=float)
    n = len(y)
    if n < 4:
        return None, None
    x = np.arange(n, dtype=float)
    x_c, y_c = x - x.mean(), y - y.mean()
    sxx = float((x_c ** 2).sum())
    slope = float((x_c * y_c).sum() / sxx)
    resid = y_c - slope * x_c
    dof = n - 2
    se = float(np.sqrt((resid ** 2).sum() / dof / sxx))
    if se == 0:
        return slope, 0.0
    t = slope / se
    from scipy import stats
    p = float(2 * stats.t.sf(abs(t), dof))
    return slope, p


def _status(history: list[dict]) -> dict[str, Any]:
    """Derive status + trend from a chronological measurement history (pure)."""
    n = len(history)
    if n < _CFG["MIN_READINGS"]:
        return {"status": "TOO_NOISY", "slope": None, "p_value": None,
                "reason": f"only {n} readings — needs {_CFG['MIN_READINGS']}+ to judge"}

    edges = [h["edge_ann_pct"] for h in history]
    tail = history[-_CFG["TREND_WINDOW"]:]
    slope, p = _ols_trend([h["edge_ann_pct"] for h in tail])

    def straddles(h) -> bool:
        return h["ci_low"] is not None and h["ci_high"] is not None \
            and h["ci_low"] <= 0.0 <= h["ci_high"]

    run = history[-_CFG["DEAD_RUN"]:]
    dead_run = len(run) == _CFG["DEAD_RUN"] and all(straddles(h) for h in run)
    run_mean = float(np.mean([h["edge_ann_pct"] for h in run if h["edge_ann_pct"] is not None]))
    latest = history[-1]

    # REVIVING outranks DEAD: an edge rising significantly with a positive latest reading
    # is on its way back up through zero, not dead.
    if slope is not None and slope > 0 and p is not None and p < _CFG["P_SIG"] \
            and (latest["edge_ann_pct"] or 0) > 0 and straddles(latest):
        return {"status": "REVIVING", "slope": round(slope, 3), "p_value": round(p, 4),
                "reason": f"edge rising {slope:+.2f}%/yr per reading "
                          f"(p={p:.3f}) — crossing up through zero"}
    if dead_run and abs(run_mean) < _CFG["DEAD_EDGE_MAX"]:
        return {"status": "DEAD", "slope": slope, "p_value": p,
                "reason": f"CI has straddled zero for {_CFG['DEAD_RUN']} straight readings "
                          f"with mean edge {run_mean:+.1f}%/yr"}
    if slope is not None and slope < 0 and p is not None and p < _CFG["P_SIG"] \
            and (latest["edge_ann_pct"] or 0) > 0:
        return {"status": "FADING", "slope": round(slope, 3), "p_value": round(p, 4),
                "reason": f"edge falling {slope:+.2f}%/yr per reading "
                          f"(p={p:.3f} over last {len(tail)} readings)"}
    if straddles(latest):
        return {"status": "WEAK", "slope": slope, "p_value": p,
                "reason": "latest confidence interval includes zero"}
    return {"status": "HEALTHY", "slope": slope, "p_value": p,
            "reason": "edge positive with CI clear of zero"}


# ── public API ────────────────────────────────────────────────────────────────
def get_observatory(universe: str = "nifty500") -> dict[str, Any]:
    """All edges: latest vitals, status, trend, and the full sparkline series.
    Raises StoreUnavailable if Postgres is down (router maps to 503)."""
    ck = f"obs:{universe}"
    today = _today()
    with _lock:
        hit = _cache.get(ck)
        if hit and hit[0] == today:
            return hit[1]

    cards = []
    for key in sorted(REGISTRY):
        meta = EDGE_META.get(key, {"label": key, "kind": "", "blurb": ""})
        history = store.read_history(key, universe, METHODOLOGY_VERSION)
        if not history:
            cards.append({"edge_key": key, **meta, "n_readings": 0, "status": "TOO_NOISY",
                          "reason": "no readings yet", "latest": None, "series": [],
                          "slope": None, "p_value": None})
            continue
        st = _status(history)
        latest = history[-1]
        cards.append({
            "edge_key": key, **meta,
            "n_readings": len(history),
            "status": st["status"], "reason": st["reason"],
            "slope": st["slope"], "p_value": st["p_value"],
            "latest": {
                "period": latest["period"], "edge_ann_pct": latest["edge_ann_pct"],
                "hit_rate": latest["hit_rate"], "decile_spread": latest["decile_spread"],
                "n_signals": latest["n_signals"],
                "ci_low": latest["ci_low"], "ci_high": latest["ci_high"],
            },
            "series": [{"period": h["period"], "edge_ann_pct": h["edge_ann_pct"],
                        "hit_rate": h["hit_rate"], "n_signals": h["n_signals"],
                        "ci_low": h["ci_low"], "ci_high": h["ci_high"],
                        "is_backfilled": h["is_backfilled"]} for h in history],
        })

    # Most newsworthy first: status severity, then |slope|
    sev = {"DEAD": 0, "FADING": 1, "REVIVING": 2, "WEAK": 3, "HEALTHY": 4, "TOO_NOISY": 5}
    cards.sort(key=lambda c: (sev.get(c["status"], 9), -abs(c["slope"] or 0)))
    out = {
        "universe": universe,
        "methodology_version": METHODOLOGY_VERSION,
        "as_of": today,
        "edges": cards,
        "status_rules": _CFG,
    }
    with _lock:
        _cache[ck] = (today, out)
    return out


def get_field_health(universe: str = "nifty500") -> dict[str, Any]:
    """Rule-builder field -> underlying edge health. Lets the Portfolio Builder badge
    rules that lean on a FADING/DEAD edge. Degrades to {} fields if Postgres is down
    (the builder works fine without badges)."""
    ck = f"fields:{universe}"
    today = _today()
    with _lock:
        hit = _cache.get(ck)
        if hit and hit[0] == today:
            return hit[1]
    try:
        obs = get_observatory(universe=universe)
    except StoreUnavailable:
        return {"fields": {}, "as_of": today}
    by_key = {e["edge_key"]: e for e in obs["edges"]}
    fields: dict[str, Any] = {}
    for field, edge_key in FIELD_EDGE_MAP.items():
        e = by_key.get(edge_key)
        if not e:
            continue
        fields[field] = {
            "edge_key": edge_key, "edge_label": e["label"],
            "status": e["status"], "reason": e["reason"],
            "latest_edge_ann_pct": (e["latest"] or {}).get("edge_ann_pct"),
        }
    out = {"fields": fields, "as_of": today}
    with _lock:
        _cache[ck] = (today, out)
    return out


def get_report(universe: str = "nifty500") -> dict[str, Any]:
    """The monthly 'State of the Edges' report — deterministic markdown composed from
    the measurement record. No LLM, no estimates: every number is a stored reading."""
    obs = get_observatory(universe=universe)
    edges = obs["edges"]
    period = max((e["latest"]["period"] for e in edges if e["latest"]), default="—")

    def delta6(e) -> Optional[float]:
        s = [p["edge_ann_pct"] for p in e["series"] if p["edge_ann_pct"] is not None]
        return round(s[-1] - s[-7], 1) if len(s) >= 7 else None

    lines = [
        f"# State of the Edges — {period}",
        "",
        f"{obs['universe'].upper()} · methodology {obs['methodology_version']} · "
        f"{len(edges)} edges under observation · rolling 24-month windows, "
        f"21-day forward returns",
        "",
        "## Headlines",
    ]
    for e in edges:                                        # already newsworthiness-sorted
        lt = e["latest"]
        if not lt:
            continue
        d6 = delta6(e)
        d6_txt = f", {'up' if d6 > 0 else 'down'} {abs(d6):.1f} pts over 6 readings" if d6 is not None else ""
        lines.append(f"- **{e['label']}** — {e['status']}: {lt['edge_ann_pct']:+.1f}%/yr "
                     f"(hit {lt['hit_rate']:.0f}%){d6_txt}. {e['reason']}.")
    lines += [
        "",
        "## Scoreboard",
        "",
        "| Edge | Status | Edge (ann.) | Hit rate | 6-reading Δ | Readings |",
        "|---|---|---|---|---|---|",
    ]
    for e in edges:
        lt = e["latest"] or {}
        d6 = delta6(e)
        lines.append(
            f"| {e['label']} | {e['status']} | "
            f"{lt.get('edge_ann_pct', 0):+.1f}%/yr | {lt.get('hit_rate', 0):.0f}% | "
            f"{f'{d6:+.1f}' if d6 is not None else '—'} | {e['n_readings']} |")
    lines += [
        "",
        "---",
        "*Generated deterministically from the append-only `edge_measurements` record. "
        "Backfilled history is computed from immutable raw data and labeled as such; "
        "live readings are never revised. Full methodology and caveats on the "
        "Edge Observatory page.*",
    ]
    return {"period": period, "universe": obs["universe"],
            "methodology_version": obs["methodology_version"],
            "as_of": obs["as_of"], "markdown": "\n".join(lines)}


def get_history(edge_key: str, universe: str = "nifty500") -> dict[str, Any]:
    """Full measurement history for one edge (detail view). Raises KeyError on an
    unknown edge, StoreUnavailable when Postgres is down."""
    if edge_key not in REGISTRY:
        raise KeyError(edge_key)
    meta = EDGE_META.get(edge_key, {"label": edge_key, "kind": "", "blurb": ""})
    history = store.read_history(edge_key, universe, METHODOLOGY_VERSION)
    st = _status(history) if history else {"status": "TOO_NOISY", "slope": None,
                                           "p_value": None, "reason": "no readings yet"}
    return {"edge_key": edge_key, **meta, "universe": universe,
            "methodology_version": METHODOLOGY_VERSION,
            "status": st["status"], "reason": st["reason"],
            "slope": st["slope"], "p_value": st["p_value"],
            "measurements": history}
