"""F&O Momentum Radar service.

Bifurcates the F&O futures universe into two positioning buckets:
  1. OI GAINERS      — futures open interest up vs the prior session
  2. SHORT COVERING  — price up while futures OI is falling (shorts exiting)

A stock enters a bucket only if it also qualifies on at least ONE of three
momentum criteria (each row reports exactly which ones fired):
  BIG_MOVE_PREV — last completed trading session moved beyond ±5%
  TOP_SECTOR    — stock belongs to today's single best-performing F&O sector
  GAP_0915      — 9:15 open gapped beyond ±2% vs previous close

Two further lists — Open=High and Open=Low — slice the union of the two
buckets above (i.e. names already qualifying on OI addition or short
covering) by intraday positioning:
  OPEN_EQ_HIGH — 9:15 open equals the day's high so far (never traded above
                 the open — sellers held the high, a weak/resistance read).
  OPEN_EQ_LOW  — 9:15 open equals the day's low so far (never traded below
                 the open — buyers held the low, a strong/support read).

Also exposes a third, independent list — Live Movers — the whole F&O universe
split into movers_up / movers_down by live day change beyond ±2%, unrelated to
the OI/quadrant buckets above.

Data substrate: reuses fno_tactical_service._get_scan() (single Kite pass,
4s-slot cache — live during market hours, DuckDB EOD fallback otherwise) and
live_trading_service._get_hist() for the prior-session close pair. This module
adds no Kite calls of its own; the marginal cost per request is pure Python.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import app.services.fno_tactical_service as _fno
import app.services.live_trading_service as _lts

log = logging.getLogger(__name__)

# ── Qualifier thresholds ──────────────────────────────────────────────────────
_BIG_MOVE_PCT = 5.0      # |last completed session return| beyond this
_GAP_PCT = 2.0           # |9:15 open vs prev close| beyond this
_TOP_SECTORS_N = 1       # "best performing sector" = top N by mean day change
_LIVE_MOVE_PCT = 2.0     # |live day change| beyond this qualifies for the Live Movers section
_OPEN_EQ_TOL = 0.005     # tolerance for open_0915 == day_high/day_low (both rounded to 2dp)


def _last_session_ret(h: dict[str, Any]) -> Optional[float]:
    """Return % of the last COMPLETED session from the hist cache.

    equities_prices rn=1/rn=2 semantics: during LIVE (today not yet ingested)
    prev_close is yesterday's close and yesterday_close the day before —
    yielding yesterday's move. After post-close ingestion rn=1 becomes today,
    so the same pair yields today's (now completed) move. Both are correct
    readings of "the last trading session".
    """
    pc = h.get("prev_close")
    yc = h.get("yesterday_close")
    if not pc or not yc:
        return None
    return round((float(pc) / float(yc) - 1) * 100, 2)


def _sector_perf(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Mean day change % per sector, best first."""
    buckets: dict[str, list[float]] = {}
    for r in rows:
        sec = r.get("sector")
        if sec:
            buckets.setdefault(sec, []).append(r["change_pct"])
    perf = [
        {"sector": sec, "avg_ret": round(sum(v) / len(v), 2), "count": len(v)}
        for sec, v in buckets.items()
    ]
    perf.sort(key=lambda p: p["avg_ret"], reverse=True)
    return perf


def _criteria(r: dict[str, Any], top_sectors: set[str]) -> list[str]:
    out: list[str] = []
    ls = r.get("last_session_ret")
    if ls is not None and abs(ls) >= _BIG_MOVE_PCT:
        out.append("BIG_MOVE_PREV")
    if r.get("sector") in top_sectors:
        out.append("TOP_SECTOR")
    gap = r.get("gap_0915_pct")
    if gap is not None and abs(gap) >= _GAP_PCT:
        out.append("GAP_0915")
    return out


def get_scan() -> dict[str, Any]:
    """Build the bifurcated momentum lists off the shared tactical scan."""
    scan = _fno._get_scan()
    hist = _lts._get_hist()

    enriched: list[dict[str, Any]] = []
    for r in scan["rows"]:
        ltp = r["ltp"]
        pc = r["prev_close"]
        if not pc:
            continue
        h = hist.get(r["symbol"], {})
        open0 = r.get("open_0915")
        enriched.append({
            "symbol": r["symbol"],
            "sector": r.get("sector"),
            "ltp": ltp,
            "prev_close": pc,
            "change_pct": round((ltp / pc - 1) * 100, 2),
            "last_session_ret": _last_session_ret(h),
            "gap_0915_pct": round((open0 / pc - 1) * 100, 2) if open0 else None,
            "oi": r.get("oi"),
            "oi_chg_pct": r.get("oi_chg_pct"),
            "quadrant": r.get("quadrant"),
            "volume": r.get("volume"),
            "open_0915": open0,
            "day_high": r.get("day_high"),
            "day_low": r.get("day_low"),
        })

    sector_perf = _sector_perf(enriched)
    top_sectors = {p["sector"] for p in sector_perf[:_TOP_SECTORS_N]}

    oi_gainers: list[dict[str, Any]] = []
    short_covering: list[dict[str, Any]] = []
    for r in enriched:
        crit = _criteria(r, top_sectors)
        if not crit:
            continue
        r["criteria"] = crit
        oi_chg = r.get("oi_chg_pct")
        if r.get("quadrant") == "SHORT_COVERING":
            short_covering.append(r)
        elif oi_chg is not None and oi_chg > 0:
            oi_gainers.append(r)

    oi_gainers.sort(key=lambda x: x["change_pct"], reverse=True)
    short_covering.sort(key=lambda x: x["change_pct"], reverse=True)

    # Open=High / Open=Low: slice the union of the two qualified buckets above
    # (already gated on OI addition or short covering + a momentum criterion)
    # by whether the 9:15 open equals the day's high/low so far.
    open_eq_high: list[dict[str, Any]] = []
    open_eq_low: list[dict[str, Any]] = []
    for r in oi_gainers + short_covering:
        open0, hi, lo = r.get("open_0915"), r.get("day_high"), r.get("day_low")
        if open0 is None:
            continue
        if hi is not None and abs(open0 - hi) <= _OPEN_EQ_TOL:
            open_eq_high.append(r)
        if lo is not None and abs(open0 - lo) <= _OPEN_EQ_TOL:
            open_eq_low.append(r)

    open_eq_high.sort(key=lambda x: x["change_pct"], reverse=True)
    open_eq_low.sort(key=lambda x: x["change_pct"], reverse=True)

    # Live movers: whole F&O universe, gated only on |live day change| ≥ threshold —
    # independent of the OI/quadrant buckets above.
    movers_up = [r for r in enriched if r["change_pct"] >= _LIVE_MOVE_PCT]
    movers_down = [r for r in enriched if r["change_pct"] <= -_LIVE_MOVE_PCT]
    for r in movers_up:
        r.setdefault("criteria", [])
    for r in movers_down:
        r.setdefault("criteria", [])
    movers_up.sort(key=lambda x: x["change_pct"], reverse=True)
    movers_down.sort(key=lambda x: x["change_pct"])

    return {
        "as_of": scan["as_of"],
        "state": scan["state"],
        "session_date": scan["session_date"],
        "data_mode": scan["data_mode"],
        "oi_live": scan["oi_live"],
        "thresholds": {
            "big_move_pct": _BIG_MOVE_PCT,
            "gap_pct": _GAP_PCT,
            "top_sectors_n": _TOP_SECTORS_N,
            "live_move_pct": _LIVE_MOVE_PCT,
        },
        "top_sectors": sector_perf[:_TOP_SECTORS_N],
        "oi_gainers": oi_gainers,
        "short_covering": short_covering,
        "open_eq_high": open_eq_high,
        "open_eq_low": open_eq_low,
        "movers_up": movers_up,
        "movers_down": movers_down,
    }


def invalidate() -> None:
    """Flush the underlying tactical + live caches (post-ingestion refresh)."""
    _fno.invalidate()
    log.info("F&O momentum: caches invalidated (via tactical service)")
