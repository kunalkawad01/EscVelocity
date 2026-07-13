"""
Edge Decay Observatory — the measurement job.

Standalone script (NEVER run inside uvicorn — CPU/DuckDB batch work starves the event
loop; see CLAUDE.md backend lessons). Writes one row per (edge, universe, period) into
Postgres `edge_measurements`, idempotently.

Usage (from marketdna-backend/ with venv):
    python -m jobs.measure_edges                      # measure latest completed month
    python -m jobs.measure_edges --backfill           # walk 2022-06 -> latest, all edges
    python -m jobs.measure_edges --edge momentum_12_1 --period 2026-06
    python -m jobs.measure_edges --if-new-month       # post-market guard: no-op unless
                                                      # a new month is measurable

Window convention: for period 'YYYY-MM', the window is the trailing WINDOW_MONTHS ending
at that month's last trading day. Forward-return truncation happens inside each edge
(formation stops FWD_BARS before the last fetched bar), so every stored signal is scored
on a complete 21-day forward window.
"""
from __future__ import annotations

# Thread caps before numpy import (Windows lesson from app/main.py)
import os
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")

import argparse
import logging
import sys
import time
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

# Standalone process: load .env before any app import builds Settings.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("measure_edges")

WINDOW_MONTHS = 24
BACKFILL_FROM = "2022-06"      # earliest period attempted; edges skip infeasible windows
DEFAULT_UNIVERSE = "nifty500"


def _month_add(period: str, k: int) -> str:
    y, m = int(period[:4]), int(period[5:7])
    t = (y * 12 + (m - 1)) + k
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def _period_bounds(period: str) -> tuple[date, date]:
    """(window_start, window_end_cap) for a period: trailing WINDOW_MONTHS ending at the
    period month's last calendar day. Edges clamp to actual trading dates internally."""
    nxt = _month_add(period, 1)
    cap = date(int(nxt[:4]), int(nxt[5:7]), 1)             # first day of next month
    cap = date.fromordinal(cap.toordinal() - 1)            # -> last day of period month
    start_p = _month_add(period, -(WINDOW_MONTHS - 1))
    window_start = date(int(start_p[:4]), int(start_p[5:7]), 1)
    return window_start, cap


def _latest_completed_period() -> str:
    """Month before the month of the newest ingested bar — the last COMPLETE month."""
    from app.services.duckdb_client import get_connection
    con = get_connection()
    max_d = con.execute("SELECT MAX(CAST(date AS DATE)) FROM equities_prices").fetchone()[0]
    if max_d is None:
        log.error("equities_prices is empty — nothing to measure")
        sys.exit(1)
    return _month_add(f"{max_d.year:04d}-{max_d.month:02d}", -1)


def run(periods: list[str], edges: list[str], universe: str) -> int:
    from app.db import StoreUnavailable
    from app.services.edges import REGISTRY, METHODOLOGY_VERSION
    from app.services.edges import store

    try:
        store.init_store()
    except StoreUnavailable as exc:
        log.error("Postgres unavailable — aborting (no half-runs): %s", exc)
        sys.exit(1)

    latest = _latest_completed_period()

    # Universe-membership snapshot for the latest period (can never be backfilled —
    # survivorship-bias antidote for future methodology versions).
    try:
        from app.services.duckdb_client import get_connection
        syms = [r[0] for r in get_connection().execute(
            "SELECT DISTINCT symbol FROM equities_prices").fetchall()]
        added = store.snapshot_universe(latest, universe, sorted(syms))
        if added:
            log.info("universe snapshot %s/%s: %d members recorded", universe, latest, added)
    except Exception as exc:
        log.warning("universe snapshot failed (non-fatal): %s", exc)

    inserted = skipped = existing = failed = 0
    for edge_key in edges:
        measure_fn = REGISTRY[edge_key]
        done = store.measured_periods(edge_key, universe, METHODOLOGY_VERSION)
        for period in periods:
            if period in done:
                existing += 1
                continue
            w_start, w_cap = _period_bounds(period)
            t0 = time.time()
            try:
                m = measure_fn(w_start, w_cap, universe)
            except Exception as exc:
                failed += 1
                log.warning("%s %s: FAILED (%s)", edge_key, period, exc)
                continue
            if m is None:
                skipped += 1
                log.info("%s %s: skipped — insufficient data in window", edge_key, period)
                continue
            is_backfilled = period < latest
            if store.insert_measurement(m, universe=universe, period=period,
                                        methodology_version=METHODOLOGY_VERSION,
                                        is_backfilled=is_backfilled):
                inserted += 1
                log.info("%s %s: edge_ann=%.2f%% hit=%.0f%% spread=%s n=%d ci=[%s,%s] (%.1fs)%s",
                         edge_key, period, m.edge_ann_pct, m.hit_rate,
                         m.decile_spread, m.n_signals, m.ci_low, m.ci_high,
                         time.time() - t0, " [backfilled]" if is_backfilled else "")
            else:
                existing += 1
    log.info("=" * 60)
    log.info("inserted=%d existing=%d skipped=%d failed=%d", inserted, existing, skipped, failed)
    return 0 if failed == 0 else 2


def main() -> int:
    ap = argparse.ArgumentParser(description="Measure edges into edge_measurements")
    ap.add_argument("--backfill", action="store_true",
                    help=f"measure every period {BACKFILL_FROM} -> latest completed month")
    ap.add_argument("--period", help="measure one period (YYYY-MM)")
    ap.add_argument("--edge", help="restrict to one edge key")
    ap.add_argument("--universe", default=DEFAULT_UNIVERSE)
    ap.add_argument("--if-new-month", action="store_true",
                    help="exit 0 immediately unless a new completed month is unmeasured "
                         "(safe to call from the daily post-market script)")
    args = ap.parse_args()

    from app.services.edges import REGISTRY, METHODOLOGY_VERSION
    edges = [args.edge] if args.edge else sorted(REGISTRY)
    if args.edge and args.edge not in REGISTRY:
        log.error("unknown edge %r — known: %s", args.edge, sorted(REGISTRY))
        return 1

    latest = _latest_completed_period()
    if args.if_new_month:
        from app.db import StoreUnavailable
        from app.services.edges import store
        try:
            store.init_store()
            if store.latest_period(args.universe, METHODOLOGY_VERSION) == latest:
                log.info("period %s already measured — nothing to do", latest)
                return 0
        except StoreUnavailable as exc:
            log.error("Postgres unavailable: %s", exc)
            return 1
        return run([latest], edges, args.universe)

    if args.backfill:
        periods, p = [], BACKFILL_FROM
        while p <= latest:
            periods.append(p)
            p = _month_add(p, 1)
    elif args.period:
        periods = [args.period]
    else:
        periods = [latest]
    return run(periods, edges, args.universe)


if __name__ == "__main__":
    sys.exit(main())
