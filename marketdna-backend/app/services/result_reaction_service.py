"""Result Reaction Service — price behaviour around each symbol's last 4
quarterly result dates, across the full F&O universe.

Result dates come from NSE's public event-calendar API (no auth/cookies
needed — verified manually):
    https://www.nseindia.com/api/event-calendar?index=equities&symbol=<SYM>
filtered to rows where purpose == "Financial Results".

NSE gives us the board-meeting *date* but not whether results were released
before or after market hours, so the reaction window is computed as:
  Day -1 : prior trading day's own return   (pre-result drift)
  Day  0 : the announcement day's own return (catches pre-market releases)
  Day +1 : the next trading day's return     (catches the common after-close release)

Startup:  load parquet if present (instant) → serve stale data immediately.
Refresh:  background batch hits NSE once per symbol (~209 calls, throttled)
          — this is slow (~2 min) and talks to an external host, so it only
          runs via start_scan_warmup() in the background prewarm, never
          synchronously, and is cached for 7 days (result dates don't change
          daily like price data does).
"""
import json
import logging
import threading
import time
from bisect import bisect_left
from datetime import datetime, timedelta

import numpy as np
import polars as pl
import requests

from app.config import settings
from app.models.result_reaction import QuarterReaction, SymbolResultReaction
from app.services.duckdb_client import get_connection
from app.services.fno_charts_service import get_symbols as _get_fo_symbols

log = logging.getLogger(__name__)

_PARQUET_PATH = settings.data_path / "data_lake" / "derived" / "result_reaction" / "scan.parquet"
_FRESH_DAYS = 7          # result dates only change quarterly -- no need to re-hit NSE daily
_MAX_QUARTERS = 4
_NSE_DELAY_SEC = 0.35    # throttle between NSE calls -- 209 symbols -> ~75s, avoids bot-blocking

_NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

_scan_results: list[SymbolResultReaction] = []
_scan_ready = False
_scan_lock = threading.Lock()
_scan_progress = {"computed": 0, "total": 0}


def _get_universe() -> list[str]:
    return _get_fo_symbols()["symbols"]


# ── NSE fetch ─────────────────────────────────────────────────────────────────

def _fetch_financial_result_dates(symbol: str, timeout: float = 10.0) -> list[str]:
    """Return quarterly-result board-meeting dates (YYYY-MM-DD), newest first.

    NSE's own `purpose` field is unreliable -- many results meetings are filed
    as "Results/Dividend" or even "Dividend/Other business matters" instead of
    "Financial Results" (confirmed for TCS, where every quarter since mid-2024
    carries an inconsistent purpose label). The free-text `bm_desc` is the
    reliable signal -- it always says "...financial results..." regardless of
    how `purpose` was filed -- so match on that instead.
    """
    r = requests.get(
        "https://www.nseindia.com/api/event-calendar",
        params={"index": "equities", "symbol": symbol},
        headers=_NSE_HEADERS,
        timeout=timeout,
    )
    r.raise_for_status()
    rows = r.json()
    dates: set[str] = set()
    for row in rows:
        if "financial result" not in (row.get("bm_desc") or "").lower():
            continue
        try:
            dates.add(datetime.strptime(row["date"], "%d-%b-%Y").strftime("%Y-%m-%d"))
        except (KeyError, ValueError):
            continue
    return sorted(dates, reverse=True)


# ── Per-symbol reaction (pure NumPy over one bulk DuckDB fetch) ──────────────

def _reaction_for_symbol(symbol: str, result_dates: list[str]) -> SymbolResultReaction:
    con = get_connection()
    df = con.execute(
        """
        SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d, close
        FROM equities_prices WHERE symbol = ? ORDER BY d
        """,
        [symbol],
    ).pl()
    if df.height < 3:
        return SymbolResultReaction(symbol=symbol, error="insufficient price history")

    dates = df["d"].to_list()
    closes = df["close"].to_numpy().astype(np.float64)
    n = len(dates)

    quarters: list[QuarterReaction] = []
    for rd in result_dates[:_MAX_QUARTERS]:
        idx = bisect_left(dates, rd)   # first trading day >= rd
        if idx < 2 or idx >= n:
            continue   # not enough history around this date (too old or too recent)
        day_m1 = float(closes[idx - 1] / closes[idx - 2] - 1.0)
        day0 = float(closes[idx] / closes[idx - 1] - 1.0)
        day_p1 = float(closes[idx + 1] / closes[idx] - 1.0) if idx + 1 < n else None
        quarters.append(QuarterReaction(
            result_date=rd, reaction_date=dates[idx],
            day_minus1_pct=day_m1, day0_pct=day0, day_plus1_pct=day_p1,
        ))

    if not quarters:
        return SymbolResultReaction(symbol=symbol, error="no result dates in covered price history")

    def _avg(vals: list[float | None]) -> float | None:
        present = [v for v in vals if v is not None]
        return float(np.mean(present)) if present else None

    day0_vals = [q.day0_pct for q in quarters]
    wins = [v for v in day0_vals if v is not None]

    return SymbolResultReaction(
        symbol=symbol,
        quarters=quarters,
        avg_day_minus1_pct=_avg([q.day_minus1_pct for q in quarters]),
        avg_day0_pct=_avg(day0_vals),
        avg_day_plus1_pct=_avg([q.day_plus1_pct for q in quarters]),
        win_rate=(sum(1 for v in wins if v > 0) / len(wins)) if wins else None,
        n_quarters=len(quarters),
    )


# ── Parquet persistence ───────────────────────────────────────────────────────

def _save_scan_to_parquet(items: list[SymbolResultReaction]) -> None:
    try:
        today = datetime.utcnow().strftime("%Y-%m-%d")
        df = pl.DataFrame({
            "symbol":              [i.symbol for i in items],
            "quarters_json":       [json.dumps([q.model_dump() for q in i.quarters]) for i in items],
            "avg_day_minus1_pct":  [i.avg_day_minus1_pct for i in items],
            "avg_day0_pct":        [i.avg_day0_pct for i in items],
            "avg_day_plus1_pct":   [i.avg_day_plus1_pct for i in items],
            "win_rate":            [i.win_rate for i in items],
            "n_quarters":          [i.n_quarters for i in items],
            "error":               [i.error for i in items],
            "computed_date":       [today] * len(items),
        })
        _PARQUET_PATH.parent.mkdir(parents=True, exist_ok=True)
        df.write_parquet(str(_PARQUET_PATH))
        log.info("result_reaction: saved %d rows to parquet -> %s", len(items), _PARQUET_PATH)
    except Exception as exc:
        log.warning("result_reaction: parquet save failed -- %s", exc)


def _load_scan_from_parquet() -> bool:
    """Load parquet into _scan_results. Returns True if still within the freshness window."""
    global _scan_results, _scan_ready
    if not _PARQUET_PATH.exists():
        return False
    try:
        df = pl.read_parquet(str(_PARQUET_PATH))
        cutoff = (datetime.utcnow() - timedelta(days=_FRESH_DAYS)).strftime("%Y-%m-%d")
        computed_dates = df["computed_date"].to_list()
        is_fresh = bool(computed_dates) and max(computed_dates) >= cutoff

        items = [
            SymbolResultReaction(
                symbol=row["symbol"],
                quarters=[QuarterReaction(**q) for q in json.loads(row["quarters_json"])],
                avg_day_minus1_pct=row["avg_day_minus1_pct"],
                avg_day0_pct=row["avg_day0_pct"],
                avg_day_plus1_pct=row["avg_day_plus1_pct"],
                win_rate=row["win_rate"],
                n_quarters=row["n_quarters"],
                error=row["error"],
            )
            for row in df.iter_rows(named=True)
        ]
        _scan_results = items
        if is_fresh:
            _scan_ready = True
            log.info("result_reaction: loaded fresh scan from parquet (%d symbols)", len(items))
        else:
            log.info("result_reaction: loaded stale scan from parquet (%d symbols) -- will refresh", len(items))
        return is_fresh
    except Exception as exc:
        log.warning("result_reaction: parquet load failed -- %s", exc)
        return False


# ── Public API ─────────────────────────────────────────────────────────────────

def get_cached_scan() -> tuple[list[SymbolResultReaction], bool]:
    """Never blocks. Returns (results, ready). Serves stale/partial data while
    a background recompute is in flight."""
    if _scan_results:
        return _scan_results, _scan_ready
    return [], _scan_ready


def get_progress() -> dict:
    return dict(_scan_progress)


def invalidate_scan() -> None:
    global _scan_results, _scan_ready
    _scan_ready = False
    if _PARQUET_PATH.exists():
        try:
            _PARQUET_PATH.unlink()
        except Exception as exc:
            log.warning("result_reaction: parquet unlink failed -- %s", exc)
    start_scan_warmup()


def start_scan_warmup() -> None:
    """Start the NSE fetch + reaction batch in a background thread."""
    def _run() -> None:
        global _scan_results, _scan_ready
        with _scan_lock:
            if _scan_ready:
                return
            if _load_scan_from_parquet():
                return   # parquet is within the freshness window -- nothing to do

            universe = _get_universe()
            _scan_progress["total"] = len(universe)
            _scan_progress["computed"] = 0
            log.info("result_reaction: batch warmup starting over %d F&O symbols...", len(universe))
            t0 = time.time()
            items: list[SymbolResultReaction] = []
            for sym in universe:
                try:
                    dates = _fetch_financial_result_dates(sym)
                    item = _reaction_for_symbol(sym, dates) if dates else \
                        SymbolResultReaction(symbol=sym, error="no 'Financial Results' events found on NSE")
                except Exception as exc:
                    log.warning("result_reaction: %s failed -- %s", sym, exc)
                    item = SymbolResultReaction(symbol=sym, error=str(exc))
                items.append(item)
                _scan_progress["computed"] = len(items)
                time.sleep(_NSE_DELAY_SEC)

            _scan_results = items
            _scan_ready = True
            log.info("result_reaction: batch warmup complete in %.1fs (%d symbols)", time.time() - t0, len(items))
            _save_scan_to_parquet(items)

    threading.Thread(target=_run, daemon=True, name="result-reaction-warmup").start()
