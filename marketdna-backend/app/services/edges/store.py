"""
Edge Decay Observatory — Postgres persistence for edge measurements.

`edge_measurements` is APPEND-ONLY and idempotent: one row per
(edge_key, universe, period, methodology_version), ON CONFLICT DO NOTHING. History is
never overwritten — a formula change bumps METHODOLOGY_VERSION and starts new rows.
This immutability is the product's integrity claim: only measurements taken at the time
count, and `is_backfilled` honestly labels the ones that weren't.

Uses the shared app.db pool (same graceful-degradation contract as the portfolio stores).
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from app.db import StoreUnavailable, connection, ensure_database
from app.services.edges.base import EdgeMeasurement

log = logging.getLogger(__name__)

_DDL = (
    """
    CREATE TABLE IF NOT EXISTS edge_measurements (
        id              BIGSERIAL PRIMARY KEY,
        edge_key        TEXT NOT NULL,
        universe        TEXT NOT NULL,
        period          TEXT NOT NULL,               -- 'YYYY-MM' measurement month
        window_start    DATE NOT NULL,               -- first formation date used
        window_end      DATE NOT NULL,               -- last formation date used
        edge_ann_pct    DOUBLE PRECISION,
        hit_rate        DOUBLE PRECISION,
        decile_spread   DOUBLE PRECISION,
        n_signals       INTEGER NOT NULL,
        ci_low          DOUBLE PRECISION,
        ci_high         DOUBLE PRECISION,
        extras          JSONB NOT NULL DEFAULT '{}'::jsonb,
        methodology_version TEXT NOT NULL,
        is_backfilled   BOOLEAN NOT NULL DEFAULT FALSE,
        measured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (edge_key, universe, period, methodology_version)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_edge_measurements_key "
    "ON edge_measurements (edge_key, universe, period)",
    # Monthly universe-membership snapshots. Survivorship bias exists because past
    # membership can't be reconstructed — so record it going forward, every measurement
    # run. Future methodology versions measure each window on its own members.
    """
    CREATE TABLE IF NOT EXISTS universe_members (
        period      TEXT NOT NULL,
        universe    TEXT NOT NULL,
        symbol      TEXT NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (period, universe, symbol)
    )
    """,
)


def init_store() -> None:
    """Create the database (fresh install) and the measurements table. Raises
    StoreUnavailable if Postgres is unreachable — the job should abort, not half-run."""
    ensure_database()
    with connection() as con:
        for stmt in _DDL:
            con.execute(stmt)


def insert_measurement(m: EdgeMeasurement, *, universe: str, period: str,
                       methodology_version: str, is_backfilled: bool) -> bool:
    """Persist one reading. Returns True if inserted, False if the row already existed
    (idempotent re-run). Raises StoreUnavailable if Postgres is down."""
    from psycopg.types.json import Jsonb
    with connection() as con:
        cur = con.execute(
            """
            INSERT INTO edge_measurements
                (edge_key, universe, period, window_start, window_end,
                 edge_ann_pct, hit_rate, decile_spread, n_signals, ci_low, ci_high,
                 extras, methodology_version, is_backfilled)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (edge_key, universe, period, methodology_version) DO NOTHING
            """,
            (m.edge_key, universe, period, m.window_start, m.window_end,
             m.edge_ann_pct, m.hit_rate, m.decile_spread, m.n_signals, m.ci_low, m.ci_high,
             Jsonb(m.extras), methodology_version, is_backfilled),
        )
        return cur.rowcount > 0


def snapshot_universe(period: str, universe: str, symbols: list[str]) -> int:
    """Record the universe membership for a period (idempotent). Returns rows inserted."""
    if not symbols:
        return 0
    with connection() as con:
        cur = con.cursor()
        cur.executemany(
            "INSERT INTO universe_members (period, universe, symbol) VALUES (%s,%s,%s) "
            "ON CONFLICT (period, universe, symbol) DO NOTHING",
            [(period, universe, s) for s in symbols])
        return cur.rowcount


def measured_periods(edge_key: str, universe: str, methodology_version: str) -> set[str]:
    """Periods already recorded for an edge — lets the job skip work it has done."""
    with connection() as con:
        rows = con.execute(
            "SELECT period FROM edge_measurements "
            "WHERE edge_key=%s AND universe=%s AND methodology_version=%s",
            (edge_key, universe, methodology_version)).fetchall()
    return {r[0] for r in rows}


def latest_period(universe: str, methodology_version: str) -> Optional[str]:
    """Most recent period recorded for ANY edge (used by --if-new-month)."""
    with connection() as con:
        row = con.execute(
            "SELECT MAX(period) FROM edge_measurements "
            "WHERE universe=%s AND methodology_version=%s",
            (universe, methodology_version)).fetchone()
    return row[0] if row else None


def read_history(edge_key: str, universe: str,
                 methodology_version: str) -> list[dict[str, Any]]:
    """Full measurement history for one edge, oldest first (for the API / trend calc)."""
    with connection() as con:
        rows = con.execute(
            """
            SELECT period, window_start, window_end, edge_ann_pct, hit_rate,
                   decile_spread, n_signals, ci_low, ci_high, extras,
                   is_backfilled, measured_at
            FROM edge_measurements
            WHERE edge_key=%s AND universe=%s AND methodology_version=%s
            ORDER BY period
            """,
            (edge_key, universe, methodology_version)).fetchall()
    out = []
    for r in rows:
        out.append({
            "period": r[0], "window_start": str(r[1]), "window_end": str(r[2]),
            "edge_ann_pct": r[3], "hit_rate": r[4], "decile_spread": r[5],
            "n_signals": r[6], "ci_low": r[7], "ci_high": r[8],
            "extras": r[9] if isinstance(r[9], dict) else json.loads(r[9] or "{}"),
            "is_backfilled": r[10], "measured_at": str(r[11]),
        })
    return out
