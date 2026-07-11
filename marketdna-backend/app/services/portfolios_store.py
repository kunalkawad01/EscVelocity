"""
Persistence for custom (user-defined) Quant Portfolios.

Each portfolio is one JSON file (a serialized `PortfolioSpec`) under
`data_lake/derived/portfolios/custom/{key}.json`. Specs are cached in-process and the
built `CustomPortfolio` objects are memoized; both caches are dropped on any write so a
create/update/delete is immediately visible. Custom portfolios then resolve by key
exactly like the built-in ones (via `portfolios_service.get_portfolio`).
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone

from app.config import settings
from app.models.portfolios import PortfolioSpec
from app.services import portfolios_rules as pr
from app.services.portfolios_rules import CustomPortfolio

log = logging.getLogger(__name__)

_DIR = settings.data_path / "data_lake" / "derived" / "portfolios" / "custom"
_lock = threading.Lock()
_specs: dict[str, PortfolioSpec] | None = None
_ports: dict[str, CustomPortfolio] = {}


def _path(key: str):
    return _DIR / f"{key}.json"


def _load_from_disk() -> dict[str, PortfolioSpec]:
    out: dict[str, PortfolioSpec] = {}
    if not _DIR.exists():
        return out
    for p in _DIR.glob("*.json"):
        try:
            spec = PortfolioSpec.model_validate_json(p.read_text(encoding="utf-8"))
            out[spec.key] = spec
        except Exception as exc:                       # skip corrupt / stale-schema files
            log.warning("custom portfolio: could not load %s (%s)", p.name, exc)
    return out


def _invalidate() -> None:
    global _specs
    with _lock:
        _specs = None
        _ports.clear()


# ── read ──────────────────────────────────────────────────────────────────────
def all_specs() -> dict[str, PortfolioSpec]:
    global _specs
    with _lock:
        if _specs is None:
            _specs = _load_from_disk()
        return dict(_specs)


def get_spec(key: str) -> PortfolioSpec | None:
    return all_specs().get(key)


def get_portfolio(key: str) -> CustomPortfolio | None:
    """Built (rule-compiled) CustomPortfolio for a key, or None if it isn't a custom one."""
    if key in _ports:
        return _ports[key]
    spec = get_spec(key)
    if spec is None:
        return None
    try:
        port = pr.build_custom(spec)
    except pr.RuleError as exc:                         # a persisted spec that no longer compiles
        log.warning("custom portfolio '%s' has invalid rules: %s", key, exc)
        return None
    _ports[key] = port
    return port


def all_portfolios() -> dict[str, CustomPortfolio]:
    out = {}
    for k in all_specs():
        p = get_portfolio(k)
        if p is not None:
            out[k] = p
    return out


# ── write ─────────────────────────────────────────────────────────────────────
def save_spec(spec: PortfolioSpec) -> PortfolioSpec:
    """Validate every rule, then persist. Raises RuleError on an invalid rule."""
    pr.validate_spec(spec)
    _DIR.mkdir(parents=True, exist_ok=True)
    if not spec.created_at:
        spec.created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    _path(spec.key).write_text(spec.model_dump_json(indent=2), encoding="utf-8")
    _invalidate()
    return spec


def delete_spec(key: str) -> bool:
    p = _path(key)
    if not p.exists():
        return False
    p.unlink()
    _invalidate()
    return True
