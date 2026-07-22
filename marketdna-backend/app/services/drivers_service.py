"""Stock Drivers content service.

Loads curated fundamental-driver dossiers (``content/drivers/<SYMBOL>.yaml``)
into memory and serves them to the drivers router. Content is editorial data
authored offline and versioned in git — there is no day-cache or expiry; the
store changes only when files change (reload via :func:`invalidate`).

Each file is validated against :class:`app.models.drivers.StockDrivers` at load
time. A malformed file is logged loudly and skipped so one bad dossier never
takes down the other ~190; load errors are surfaced in the coverage payload.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Optional

import yaml

from app.models.drivers import DriversCoverage, LiveValue, StockDrivers

log = logging.getLogger(__name__)

_CONTENT_DIR = Path(__file__).resolve().parents[2] / "content" / "drivers"

_lock = threading.Lock()
_dossiers: Optional[dict[str, StockDrivers]] = None
_load_errors: list[str] = []


def load_all() -> None:
    """Parse and validate every dossier YAML. Called synchronously at startup.

    Idempotent and thread-safe; safe to call again after content edits
    (that is exactly what :func:`invalidate` does).
    """
    global _dossiers, _load_errors
    with _lock:
        dossiers: dict[str, StockDrivers] = {}
        errors: list[str] = []
        files = sorted(_CONTENT_DIR.glob("*.yaml")) if _CONTENT_DIR.is_dir() else []
        for path in files:
            try:
                with path.open(encoding="utf-8") as fh:
                    raw = yaml.safe_load(fh)
                dossier = StockDrivers.model_validate(raw)
            except Exception as exc:
                msg = f"{path.name}: {exc}"
                errors.append(msg)
                log.error("drivers: failed to load %s", msg)
                continue
            symbol = dossier.symbol.upper()
            if symbol != path.stem.upper():
                log.warning(
                    "drivers: %s declares symbol %s (filename wins for lookup consistency)",
                    path.name, dossier.symbol,
                )
            dossiers[symbol] = dossier
        _dossiers = dossiers
        _load_errors = errors
        _live_cache.clear()
        log.info("drivers: loaded %d dossiers (%d errors) from %s",
                 len(dossiers), len(errors), _CONTENT_DIR)


def _store() -> dict[str, StockDrivers]:
    """Return the dossier store, loading lazily if startup didn't run (tests)."""
    if _dossiers is None:
        load_all()
    assert _dossiers is not None
    return _dossiers


def get_drivers(symbol: str) -> Optional[StockDrivers]:
    """Return the dossier for ``symbol`` (case-insensitive) or None if not covered."""
    return _store().get(symbol.upper())


# ── Live-metric resolution (step 6) ──────────────────────────────────────────
# A dossier driver may carry `live: {metric, label}`. At request time the metric
# is resolved from our own data (options IV history, futures parquet) and
# attached to the response as `live_values`. Resolution failures degrade
# silently — the editorial card renders without the live chip, never a 500.

_live_cache: dict[tuple[str, str, str], Optional[LiveValue]] = {}  # (symbol, metric, day) — rolls daily


def _resolve_atm_iv_percentile(symbol: str) -> Optional[LiveValue]:
    from app.services import options_service
    snap = options_service.get_atm_iv_snapshot(symbol)
    if not snap:
        return None
    if snap.get("iv_percentile") is not None:
        pct = float(snap["iv_percentile"])
        detail = f"ATM IV {snap['atm_iv']:.1f}% — {pct:.0f}th percentile of {snap['n_days']}d history"
        value = pct
    else:
        # History shorter than the rank threshold — show raw IV honestly instead of nothing
        detail = f"ATM IV {snap['atm_iv']:.1f}% — percentile after 20d history ({snap['n_days']}d so far)"
        value = float(snap["atm_iv"])
    return LiveValue(
        metric="atm_iv_percentile",
        value=value,
        unit="pctile" if snap.get("iv_percentile") is not None else "%",
        detail=detail,
        as_of=str(snap["date"]),
    )


def _resolve_futures_basis(symbol: str) -> Optional[LiveValue]:
    from app.services.duckdb_client import ensure_fo_views, get_connection
    ensure_fo_views()
    try:
        row = get_connection().execute(
            """
            SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d, basis_pct,
                   STRFTIME('%Y-%m-%d', CAST(expiry AS DATE)) AS exp
            FROM futures_chain
            WHERE symbol = ? AND basis_pct IS NOT NULL
              AND date = (SELECT MAX(date) FROM futures_chain)
            LIMIT 1
            """,
            [symbol],
        ).fetchone()
    except Exception as exc:  # futures_chain view may not exist yet
        log.warning("drivers live: futures_basis unavailable — %s", exc)
        return None
    if not row:
        return None
    d, basis_pct, exp = row
    stance = "premium (long bias)" if basis_pct >= 0 else "discount (short bias)"
    return LiveValue(
        metric="futures_basis",
        value=round(float(basis_pct), 2),
        unit="%",
        detail=f"Futures at {basis_pct:+.2f}% vs spot ({stance}), expiry {exp}",
        as_of=str(d),
    )


_LIVE_REGISTRY = {
    "atm_iv_percentile": _resolve_atm_iv_percentile,
    "futures_basis": _resolve_futures_basis,
}


def get_drivers_enriched(symbol: str) -> Optional[StockDrivers]:
    """Dossier + resolved live metrics for every driver that declares a `live` wiring."""
    dossier = get_drivers(symbol)
    if dossier is None:
        return dossier
    metrics = {d.live.metric for d in dossier.drivers if d.live is not None}
    if not metrics:
        return dossier
    from datetime import date as _date
    today = _date.today().isoformat()
    values: dict[str, LiveValue] = {}
    for m in sorted(metrics):
        key = (dossier.symbol.upper(), m, today)
        if key not in _live_cache:
            resolver = _LIVE_REGISTRY.get(m)
            try:
                _live_cache[key] = resolver(dossier.symbol.upper()) if resolver else None
            except Exception as exc:
                log.warning("drivers live: %s/%s failed — %s", dossier.symbol, m, exc)
                _live_cache[key] = None
        if _live_cache[key] is not None:
            values[m] = _live_cache[key]
    return dossier.model_copy(update={"live_values": values})


def invalidate_live() -> None:
    """Clear resolved live metrics (call after options/futures ingestion)."""
    _live_cache.clear()


def get_coverage() -> DriversCoverage:
    """Symbols with a dossier, plus any file-level load errors for visibility."""
    store = _store()
    return DriversCoverage(
        symbols=sorted(store.keys()),
        count=len(store),
        errors=list(_load_errors),
    )


def invalidate() -> DriversCoverage:
    """Re-read all dossier files from disk (after editing YAML, no restart needed)."""
    load_all()
    return get_coverage()
