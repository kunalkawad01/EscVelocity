"""PostgreSQL connectivity for MarketDNA's application layer.

A single, lazily-opened psycopg3 connection pool. The first component that needs
the DB (currently custom Quant Portfolios) creates the pool. If the Postgres
server is unreachable, callers get `StoreUnavailable` and the app degrades to
built-in-only behaviour instead of crashing.

Connection settings come from `settings.pg_*` (env: MARKETDNA_PG_HOST, _PORT,
_DB, _USER, _PASSWORD). This is the first consumer of the "planned" Postgres app
layer noted in CLAUDE.md — keep it dependency-light and non-fatal on failure.
"""
from __future__ import annotations

import logging
import threading
from contextlib import contextmanager

from app.config import settings

log = logging.getLogger(__name__)


class StoreUnavailable(RuntimeError):
    """Raised when the Postgres server cannot be reached."""


_pool = None
_lock = threading.Lock()


def _conninfo() -> str:
    return (
        f"host={settings.pg_host} port={settings.pg_port} "
        f"dbname={settings.pg_db} user={settings.pg_user} "
        f"password={settings.pg_password}"
    )


def _get_pool():
    global _pool
    if _pool is None:
        with _lock:
            if _pool is None:
                from psycopg_pool import ConnectionPool
                # open=True fills the pool in a background worker; a down server
                # does NOT block here — it surfaces as PoolTimeout on checkout.
                _pool = ConnectionPool(
                    _conninfo(),
                    min_size=1,
                    max_size=5,
                    timeout=5,                       # max wait to check out a connection
                    max_idle=300,
                    kwargs={"autocommit": True, "connect_timeout": 5},
                    open=True,
                )
    return _pool


@contextmanager
def connection():
    """Yield a pooled autocommit connection.

    Raises `StoreUnavailable` if the Postgres server is unreachable so callers can
    degrade gracefully. The pool self-heals: once the server is back, subsequent
    checkouts succeed without a restart.
    """
    import psycopg
    from psycopg_pool import PoolTimeout
    try:
        pool = _get_pool()
        with pool.connection() as con:
            yield con
    except (psycopg.OperationalError, PoolTimeout) as exc:
        raise StoreUnavailable(f"PostgreSQL unavailable: {exc}") from exc


def ensure_database() -> None:
    """Create the target database if it doesn't exist yet.

    Connects to the always-present `postgres` maintenance DB with the same
    credentials and issues CREATE DATABASE. This means a fresh Postgres install
    needs no manual `CREATE DATABASE marketdna` step. Raises `StoreUnavailable`
    if the server is unreachable.
    """
    import re
    import psycopg
    from psycopg_pool import PoolTimeout

    dbname = settings.pg_db
    if not re.fullmatch(r"[A-Za-z0-9_]+", dbname):     # our own setting, but guard the DDL interpolation
        raise ValueError(f"unsafe pg_db name: {dbname!r}")
    admin = (
        f"host={settings.pg_host} port={settings.pg_port} dbname=postgres "
        f"user={settings.pg_user} password={settings.pg_password} connect_timeout=5"
    )
    try:
        with psycopg.connect(admin, autocommit=True) as con:
            exists = con.execute(
                "SELECT 1 FROM pg_database WHERE datname = %s", (dbname,)
            ).fetchone()
            if not exists:
                con.execute(f'CREATE DATABASE "{dbname}"')
                log.info("created database %r", dbname)
    except (psycopg.OperationalError, PoolTimeout) as exc:
        raise StoreUnavailable(f"PostgreSQL unavailable: {exc}") from exc


def ping() -> bool:
    """True if a trivial query succeeds against the server."""
    try:
        with connection() as con:
            con.execute("SELECT 1")
        return True
    except StoreUnavailable:
        return False
