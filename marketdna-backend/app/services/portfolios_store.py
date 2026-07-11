"""
Persistence for custom (user-defined) Quant Portfolios.

Specs live in **PostgreSQL** — table `custom_portfolios`, one JSONB row per spec
keyed by `key`. This replaces the previous one-JSON-file-per-portfolio store,
which lived under the git-ignored data lake and was lost to `git clean`.

Specs are cached in-process and the built `CustomPortfolio` objects are memoized;
both caches are dropped on any write so a create/update/delete is immediately
visible. Custom portfolios then resolve by key exactly like the built-in ones
(via `portfolios_service.get_portfolio`).

Graceful degradation: if the Postgres server is unreachable, reads return an empty
set (built-in portfolios keep working and are NOT cached-as-empty, so the store
self-heals when the DB returns) and writes raise `StoreUnavailable`, which the
router maps to HTTP 503.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone

from psycopg.types.json import Jsonb

from app.config import settings
from app.db import StoreUnavailable, connection, ensure_database
from app.models.portfolios import PortfolioSpec
from app.services import portfolios_rules as pr
from app.services.portfolios_rules import CustomPortfolio

log = logging.getLogger(__name__)

# Legacy JSON location — read once at startup to migrate any pre-existing specs.
_LEGACY_DIR = settings.data_path / "data_lake" / "derived" / "portfolios" / "custom"

_lock = threading.Lock()
_specs: dict[str, PortfolioSpec] | None = None
_ports: dict[str, CustomPortfolio] = {}

_DDL = """
CREATE TABLE IF NOT EXISTS custom_portfolios (
    key         TEXT PRIMARY KEY,
    spec        JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""


# ── schema / migration (called once at startup) ─────────────────────────────────
def init_store() -> None:
    """Ensure the table exists and migrate any legacy JSON specs into Postgres.

    Non-fatal: if Postgres is unreachable this logs a warning and returns, so the
    app still serves built-in portfolios."""
    try:
        ensure_database()                              # create the DB on a fresh install
        with connection() as con:
            con.execute(_DDL)
    except StoreUnavailable as exc:
        log.warning("custom portfolios: Postgres unavailable at startup (%s) — "
                    "custom portfolios disabled until the DB is reachable", exc)
        return
    _migrate_legacy_json()


def _migrate_legacy_json() -> None:
    """Import any surviving `custom/*.json` specs (from the old file store) into
    Postgres. Idempotent (ON CONFLICT DO NOTHING); leaves the files in place."""
    if not _LEGACY_DIR.exists():
        return
    files = list(_LEGACY_DIR.glob("*.json"))
    if not files:
        return
    migrated = 0
    for p in files:
        try:
            spec = PortfolioSpec.model_validate_json(p.read_text(encoding="utf-8"))
        except Exception as exc:                       # skip corrupt / stale-schema files
            log.warning("custom portfolios: skip legacy %s (%s)", p.name, exc)
            continue
        try:
            with connection() as con:
                cur = con.execute(
                    "INSERT INTO custom_portfolios (key, spec) VALUES (%s, %s) "
                    "ON CONFLICT (key) DO NOTHING",
                    (spec.key, Jsonb(spec.model_dump())),
                )
                if cur.rowcount:
                    migrated += 1
        except StoreUnavailable:
            return
    if migrated:
        log.info("custom portfolios: migrated %d legacy JSON spec(s) into Postgres", migrated)
        _invalidate()


def _invalidate() -> None:
    global _specs
    with _lock:
        _specs = None
        _ports.clear()


# ── read ────────────────────────────────────────────────────────────────────────
def _load_from_db() -> dict[str, PortfolioSpec]:
    """Load all specs from Postgres. Raises StoreUnavailable if the DB is down."""
    with connection() as con:
        rows = con.execute("SELECT key, spec FROM custom_portfolios").fetchall()
    out: dict[str, PortfolioSpec] = {}
    for key, spec_json in rows:                        # spec_json: JSONB decoded to dict
        try:
            out[key] = PortfolioSpec.model_validate(spec_json)
        except Exception as exc:                       # a persisted spec on a stale schema
            log.warning("custom portfolios: could not parse spec '%s' (%s)", key, exc)
    return out


def all_specs() -> dict[str, PortfolioSpec]:
    """All custom specs, keyed by key. Returns {} (uncached) if Postgres is down,
    so the set repopulates automatically once the DB is reachable again."""
    global _specs
    with _lock:
        if _specs is not None:
            return dict(_specs)
    try:
        loaded = _load_from_db()                       # DB I/O outside the lock
    except StoreUnavailable as exc:
        log.warning("custom portfolios: read failed (%s) — returning none", exc)
        return {}
    with _lock:
        _specs = loaded
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
    """Validate every rule, then persist (upsert). Raises RuleError on an invalid
    rule, StoreUnavailable if Postgres is down."""
    pr.validate_spec(spec)
    if not spec.created_at:
        spec.created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with connection() as con:
        con.execute(
            "INSERT INTO custom_portfolios (key, spec) VALUES (%s, %s) "
            "ON CONFLICT (key) DO UPDATE SET spec = EXCLUDED.spec, updated_at = now()",
            (spec.key, Jsonb(spec.model_dump())),
        )
    _invalidate()
    return spec


def delete_spec(key: str) -> bool:
    """Delete a spec. Returns False if no such key. Raises StoreUnavailable if down."""
    with connection() as con:
        cur = con.execute("DELETE FROM custom_portfolios WHERE key = %s", (key,))
        deleted = cur.rowcount > 0
    if deleted:
        _invalidate()
    return deleted
