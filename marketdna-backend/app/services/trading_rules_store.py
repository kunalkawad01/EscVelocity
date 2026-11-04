"""
Persistence for the personal Trading Rules page.

Single JSONB document in PostgreSQL — table `trading_rules`, one row (id=`default`)
holding the entire `categories` array. This is a single-user scratchpad (discipline
and risk rules), not a multi-row dataset, so unlike `custom_portfolios` there is no
per-key addressing — just one document, replaced wholesale on every save.

Default seed content lives on the frontend (`useTradingRules.ts`'s
`DEFAULT_TRADING_RULES`), not here: on first load with no row present, the client
seeds its own defaults and PUTs them, so defaults never need duplicating server-side.

Graceful degradation: if Postgres is unreachable, reads return `None` (the frontend
falls back to its own local copy) and writes raise `StoreUnavailable`, which the
router maps to HTTP 503.
"""
from __future__ import annotations

import logging
import threading

from psycopg.types.json import Jsonb

from app.db import StoreUnavailable, connection, ensure_database
from app.models.trading_rules import TradingRulesDoc

log = logging.getLogger(__name__)

_ROW_ID = "default"

_lock = threading.Lock()
_cached: TradingRulesDoc | None = None
_loaded = False

_DDL = """
CREATE TABLE IF NOT EXISTS trading_rules (
    id          TEXT PRIMARY KEY,
    data        JSONB       NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""


def init_store() -> None:
    """Ensure the table exists. Non-fatal: logs and returns if Postgres is down."""
    try:
        ensure_database()
        with connection() as con:
            con.execute(_DDL)
    except StoreUnavailable as exc:
        log.warning("trading rules: Postgres unavailable at startup (%s) — "
                    "stays unavailable (503) until the DB is reachable", exc)


def _invalidate() -> None:
    global _cached, _loaded
    with _lock:
        _cached = None
        _loaded = False


def get_doc() -> TradingRulesDoc | None:
    """The saved rulebook, or None if nothing has been saved yet.

    Returns None (not an error) if Postgres is unreachable, so the frontend can
    silently fall back to its local copy instead of showing an error on every load.
    """
    global _cached, _loaded
    with _lock:
        if _loaded:
            return _cached
    try:
        with connection() as con:
            row = con.execute(
                "SELECT data, updated_at FROM trading_rules WHERE id = %s", (_ROW_ID,)
            ).fetchone()
    except StoreUnavailable as exc:
        log.warning("trading rules: read failed (%s) — returning none", exc)
        return None
    doc = None
    if row is not None:
        data, updated_at = row
        try:
            doc = TradingRulesDoc(categories=data["categories"], updated_at=updated_at.isoformat())
        except Exception as exc:                        # a persisted doc on a stale schema
            log.warning("trading rules: could not parse stored doc (%s)", exc)
    with _lock:
        _cached = doc
        _loaded = True
    return doc


def save_doc(doc: TradingRulesDoc) -> TradingRulesDoc:
    """Upsert the whole rulebook. Raises StoreUnavailable if Postgres is down."""
    payload = {"categories": [c.model_dump() for c in doc.categories]}
    with connection() as con:
        row = con.execute(
            "INSERT INTO trading_rules (id, data) VALUES (%s, %s) "
            "ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now() "
            "RETURNING updated_at",
            (_ROW_ID, Jsonb(payload)),
        ).fetchone()
    saved = TradingRulesDoc(categories=doc.categories, updated_at=row[0].isoformat())
    _invalidate()
    return saved
