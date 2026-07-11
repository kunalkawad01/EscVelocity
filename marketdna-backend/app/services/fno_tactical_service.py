"""F&O Live Tactical Dashboard service.

Surfaces trend-aligned pullback entries for the NSE F&O universe: buy dips in
monthly uptrends, sell rallies in monthly downtrends. Stacks four filters —
breadth gate → OI positioning → normalized 9:15 lines → option chain.

Transport note: the source skill (fno.md) prescribes APScheduler + a Kite
WebSocket ticker. This codebase has neither; every live page instead uses
frontend 5s polling + in-process lock-guarded micro-caches + a DuckDB EOD
fallback (see live_trading_service, intraday_race_service). We follow that
convention. The *logic* (fields, quadrants, grades, market-state machine)
follows the skill exactly.

Reuses the proven live substrate in live_trading_service:
  _get_hist, _get_quotes, _push_intraday, _iday, _market_is_open, SECTOR_MAP,
  _symbol_sector, _get_nfo_instrument, get_stock_options, get_strike_chart_data.
"""
from __future__ import annotations

import csv
import logging
import os
import threading
import time as _time
from datetime import datetime, timedelta
from typing import Any, Optional

import numpy as np

import app.services.live_trading_service as _lts
from app.services.duckdb_client import get_connection
from app.services.kite_client import get_kite

log = logging.getLogger(__name__)

# ── Tunables ──────────────────────────────────────────────────────────────────
_EXTENDED_ATR = 1.5          # |ret_per_atr| beyond this = late / spent pullback
_SIGNAL_START_MIN = 605      # 10:05 IST — suppress V/inv-V signals for first ~50 min
_MKT_OPEN_MIN = 555          # 09:15
_MKT_CLOSE_MIN = 930         # 15:30
_PRECOMPUTE_MIN = 540        # 09:00
_MIN_VOL_RATIO = 0.15        # today volume vs 20d avg — liquidity floor (soft)
_SCAN_TTL = 4                # seconds; coalesce concurrent 5s polls onto one Kite scan

# NSE equity-segment trading holidays. Refresh annually from the NSE circular.
# (2025 is authoritative; 2026 lists the fixed-date national holidays only —
# update with the full 2026 circular when published.)
_NSE_HOLIDAYS: set[str] = {
    # 2025
    "2025-02-26", "2025-03-14", "2025-03-31", "2025-04-10", "2025-04-14",
    "2025-04-18", "2025-05-01", "2025-08-15", "2025-08-27", "2025-10-02",
    "2025-10-22", "2025-11-05", "2025-12-25",
    # 2026 (fixed-date national holidays — verify against NSE circular)
    "2026-01-26", "2026-05-01", "2026-08-15", "2026-10-02", "2026-12-25",
}


# ── F&O universe (from marketdna-data/FO.csv, column "Ticker") ────────────────
def _load_fo_universe() -> list[str]:
    path = os.path.normpath(os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "marketdna-data", "FO.csv",
    ))
    syms: list[str] = []
    try:
        with open(path, newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                t = (row.get("Ticker") or row.get("ticker") or "").strip()
                if t:
                    syms.append(t.upper())
        log.info("F&O tactical: loaded %d symbols from FO.csv", len(syms))
    except Exception as exc:
        log.warning("F&O tactical: FO.csv load failed (%s) — falling back to universe", exc)
    return syms


_FO_SYMBOLS: list[str] = _load_fo_universe()


# ── IST helpers ───────────────────────────────────────────────────────────────
def _ist_now() -> datetime:
    return datetime.utcnow() + timedelta(hours=5, minutes=30)


def _is_trading_day(d) -> bool:
    return d.weekday() < 5 and d.isoformat() not in _NSE_HOLIDAYS


def _last_session_date(ref) -> str:
    d = ref
    while not _is_trading_day(d):
        d -= timedelta(days=1)
    return d.isoformat()


# ── Market-state machine (market-state.md) ────────────────────────────────────
def resolve_market_state(now: Optional[datetime] = None) -> dict[str, Any]:
    """Resolve the page state from the NSE calendar, never the clock alone."""
    ist = now or _ist_now()
    d = ist.date()
    mins = ist.hour * 60 + ist.minute
    server_time = ist.strftime("%H:%M:%S")

    def _pretty(iso: str) -> str:
        y, m, dd = iso.split("-")
        return datetime(int(y), int(m), int(dd)).strftime("%d %b")

    if not _is_trading_day(d):
        sess = _last_session_date(d)
        state = "HOLIDAY"
        label = f"HOLIDAY — showing {_pretty(sess)} close"
    elif mins < _PRECOMPUTE_MIN:
        sess = d.isoformat()
        state = "PRE_PRECOMPUTE"
        label = "PRE-MARKET — daily data builds at 09:00"
    elif mins < _MKT_OPEN_MIN:
        sess = d.isoformat()
        state = "PRE_OPEN"
        label = "PRE-OPEN — waiting for 09:15"
    elif mins < _MKT_CLOSE_MIN:
        sess = d.isoformat()
        state = "LIVE"
        label = f"LIVE {ist.strftime('%H:%M')}"
    else:
        sess = d.isoformat()
        state = "CLOSED"
        label = f"CLOSED — showing {_pretty(sess)} close"

    return {
        "state": state,
        "session_date": sess,
        "label": label,
        "is_live": state == "LIVE",
        "server_time": server_time,
    }


def get_state() -> dict[str, Any]:
    return resolve_market_state()


# ── Prior-day futures OI + front expiry (from futures_chain EOD parquet) ──────
_fut_meta: dict[str, dict[str, Any]] = {}   # symbol → {oi_prev, expiry}
_fut_meta_date: str = ""
_fut_meta_lock = threading.Lock()


def _get_fut_meta() -> dict[str, dict[str, Any]]:
    """Latest-session futures OI + monthly expiry per symbol, cached per day.

    oi_prev here = last settled session's futures OI (the skill's oi_prev_close).
    expiry is the current monthly contract expiry string (YYYY-MM-DD) used to
    resolve NFO tokens via _get_nfo_instrument.
    """
    global _fut_meta, _fut_meta_date
    today = _ist_now().date().isoformat()
    if _fut_meta_date == today and _fut_meta:
        return _fut_meta
    with _fut_meta_lock:
        if _fut_meta_date == today and _fut_meta:
            return _fut_meta
        meta: dict[str, dict[str, Any]] = {}
        try:
            con = get_connection()
            rows = con.execute("""
                WITH latest AS (
                    SELECT symbol, MAX(date) AS md FROM futures_chain GROUP BY symbol
                )
                SELECT f.symbol,
                       STRFTIME('%Y-%m-%d', CAST(f.expiry AS DATE)) AS expiry,
                       f.oi, f.oi_change
                FROM futures_chain f
                JOIN latest l ON f.symbol = l.symbol AND f.date = l.md
            """).fetchall()
            for sym, expiry, oi, oi_change in rows:
                meta[str(sym).upper()] = {
                    "oi_prev": int(oi) if oi is not None else None,
                    "oi_change": int(oi_change) if oi_change is not None else 0,
                    "expiry": expiry,
                }
            log.info("F&O tactical: futures meta for %d symbols", len(meta))
        except Exception as exc:
            log.warning("F&O tactical: futures_chain read failed: %s", exc)
        _fut_meta = meta
        _fut_meta_date = today
    return _fut_meta


def _live_futures_oi(symbols: list[str], fut_meta: dict[str, dict[str, Any]]) -> dict[str, int]:
    """Live futures OI via Kite quote() on FUT tradingsymbols. {} on any failure."""
    try:
        kite = get_kite()
        tsym_to_sym: dict[str, str] = {}
        for sym in symbols:
            m = fut_meta.get(sym)
            if not m or not m.get("expiry"):
                continue
            inst = _lts._get_nfo_instrument(sym, m["expiry"], 0, "FUT")
            if inst:
                tsym_to_sym[f"NFO:{inst[1]}"] = sym
        if not tsym_to_sym:
            return {}
        keys = list(tsym_to_sym.keys())
        out: dict[str, int] = {}
        for i in range(0, len(keys), 500):
            chunk = keys[i:i + 500]
            resp = kite.quote(chunk)
            for k, val in resp.items():
                sym = tsym_to_sym.get(k)
                if sym is not None:
                    out[sym] = int(val.get("oi") or 0)
        log.info("F&O tactical: live futures OI for %d/%d symbols", len(out), len(symbols))
        return out
    except Exception as exc:
        log.warning("F&O tactical: live futures OI failed: %s", exc)
        return {}


# ── Derived-field rules (skill spec — implement exactly) ──────────────────────
def _sign(x: float) -> int:
    return 1 if x > 0 else (-1 if x < 0 else 0)


def _quadrant(price_dir: int, oi_dir: int) -> Optional[str]:
    if price_dir == 0 or oi_dir == 0:
        return None
    if price_dir > 0 and oi_dir > 0:
        return "LONG_BUILDUP"
    if price_dir > 0 and oi_dir < 0:
        return "SHORT_COVERING"
    if price_dir < 0 and oi_dir > 0:
        return "SHORT_BUILDUP"
    return "LONG_UNWINDING"


def _trend(ltp: float, sma20: Optional[float], sma50: Optional[float],
           closes_60d: list[float]) -> str:
    """UP if ltp>dma50 & dma20>dma50 & slope50>0; DOWN mirror; else NONE.

    dma20/dma50 = sma20/sma50. slope50 = 50-DMA now minus 50-DMA 5 sessions ago,
    computed from closes_60d (most-recent-first).
    """
    if not sma20 or not sma50 or len(closes_60d) < 10:
        return "NONE"
    n = len(closes_60d)
    now_w = closes_60d[0:min(50, n)]
    past_w = closes_60d[5:min(55, n)] if n >= 15 else now_w
    slope50 = (float(np.mean(now_w)) - float(np.mean(past_w))) if past_w else 0.0
    if ltp > sma50 and sma20 > sma50 and slope50 > 0:
        return "UP"
    if ltp < sma50 and sma20 < sma50 and slope50 < 0:
        return "DOWN"
    return "NONE"


def _grade(row: dict[str, Any], verdict: str, state: str, mins: int) -> dict[str, Any]:
    """Server-side signal grade per strategy.md quadrant→grade table + gates."""
    reasons: list[str] = []
    none = {"direction": "none", "grade": "NONE", "size": "none", "reasons": reasons}

    trend = row["trend"]
    if trend == "NONE":
        reasons.append("No monthly trend — sit out chop")
        return none

    direction = "long" if trend == "UP" else "short"
    quad = row.get("quadrant")

    # Breadth gate — hard filter (position-sizing summary)
    if direction == "long" and verdict == "RISK_OFF":
        reasons.append("Breadth RISK-OFF — longs suppressed")
        return none
    if direction == "short" and verdict == "RISK_ON":
        reasons.append("Breadth RISK-ON — shorts suppressed")
        return none

    # Time-of-day filter — 9:15 base needs the opening auction to settle
    if state == "LIVE" and mins < _SIGNAL_START_MIN:
        reasons.append("First ~45–60 min — normalization not yet trustworthy")
        return none

    # Extended-move filter — pullback already spent
    if row.get("extended"):
        reasons.append(f"|ret/ATR| > {_EXTENDED_ATR} — extended, pullback spent")
        return none

    # Quadrant → grade
    if direction == "long":
        if quad == "LONG_BUILDUP":
            grade = "A"
        elif quad == "SHORT_COVERING":
            grade = "B"; reasons.append("Short covering — exhaustion, half size")
        else:
            reasons.append(f"Quadrant {quad or '—'} not long-supportive")
            return none
    else:
        if quad == "SHORT_BUILDUP":
            grade = "A"
        elif quad == "LONG_UNWINDING":
            grade = "B"; reasons.append("Longs unwinding — half size, quicker exit")
        else:
            reasons.append(f"Quadrant {quad or '—'} not short-supportive")
            return none

    # Relative strength must align (skill: must-hold)
    rs = row.get("rel_strength", 0.0)
    if direction == "long" and rs <= 0:
        reasons.append("Rel strength not positive — not leading off the lows")
        return none
    if direction == "short" and rs >= 0:
        reasons.append("Rel strength not negative — not lagging off the highs")
        return none

    # VWAP side (skill: price back above/below VWAP)
    av = row.get("above_vwap")
    if av is not None:
        if direction == "long" and not av:
            reasons.append("Below VWAP — wait for reclaim")
            return none
        if direction == "short" and av:
            reasons.append("Above VWAP — wait for loss of VWAP")
            return none

    # Size: A + aligned gate → full; B or NEUTRAL gate → half
    aligned = (direction == "long" and verdict == "RISK_ON") or \
              (direction == "short" and verdict == "RISK_OFF")
    size = "full" if (grade == "A" and aligned) else "half"
    if verdict == "NEUTRAL":
        size = "half"
        reasons.append("NEUTRAL gate — half size, A-grade only")
    reasons.insert(0, f"{'A' if grade == 'A' else 'B'}-grade {direction} — {quad}")
    return {"direction": direction, "grade": grade, "size": size, "reasons": reasons}


# ── Core scan (single Kite pass, cached per 5s slot) ──────────────────────────
_scan_cache: dict[str, dict[str, Any]] = {}
_scan_lock = threading.Lock()


def _slot() -> int:
    return int(_time.time() // _SCAN_TTL)


def _compute_scan() -> dict[str, Any]:
    st = resolve_market_state()
    state = st["state"]
    hist = _lts._get_hist()
    universe = [s for s in _FO_SYMBOLS if s in hist] or list(hist.keys())

    live_ok = state == "LIVE"
    quotes, data_mode = _lts._get_quotes(hist, universe)
    if data_mode == "live":
        _lts._push_intraday(quotes)

    fut_meta = _get_fut_meta()
    oi_live = _live_futures_oi(universe, fut_meta) if live_ok else {}

    ist = _ist_now()
    mins = ist.hour * 60 + ist.minute

    # First pass — per-symbol raw metrics (nifty proxy needs all ret_pct first)
    raw: list[dict[str, Any]] = []
    for sym in universe:
        q = quotes.get(sym)
        h = hist.get(sym)
        if not q or not h:
            continue
        ltp = float(q["ltp"])

        # open_0915: live first tick → quote open → today_open
        open0 = None
        if live_ok:
            buf = _lts._iday.get(sym, [])
            for t, px in buf:
                if t == "09:15":
                    open0 = px
                    break
        if not open0:
            open0 = float(q.get("open") or h.get("today_open") or ltp)
        if not open0:
            open0 = ltp

        # prev_close for quadrant price-direction (daily prev close)
        if live_ok:
            pc = float(q.get("prev_close") or h.get("prev_close") or ltp)
        else:
            pc = float(h.get("yesterday_close") or h.get("prev_close") or ltp)

        atr14 = float(h.get("atr14") or 0) or None
        ret_pct = round((ltp / open0 - 1) * 100, 3) if open0 else 0.0
        ret_per_atr = round((ltp - open0) / atr14, 3) if atr14 else 0.0

        # OI + quadrant
        oi_now: Optional[int]
        oi_prev: Optional[int]
        if live_ok and sym in oi_live:
            oi_now = oi_live[sym]
            oi_prev = fut_meta.get(sym, {}).get("oi_prev")
        else:
            # EOD/settled quadrant: latest futures OI vs prior-day OI (oi - oi_change)
            m = fut_meta.get(sym, {})
            oi_now = m.get("oi_prev")
            oi_prev = (oi_now - m.get("oi_change", 0)) if oi_now is not None else None

        oi_chg_pct = None
        quad = None
        if oi_now is not None and oi_prev:
            oi_chg_pct = round((oi_now / oi_prev - 1) * 100, 2)
            quad = _quadrant(_sign(ltp - pc), _sign(oi_now - oi_prev))

        vwap = q.get("vwap")
        above_vwap = (ltp > float(vwap)) if vwap else None
        volume = float(q.get("volume") or 0)
        avg_vol = float(h.get("avg_vol20") or 0)
        liquid = True if avg_vol <= 0 else (volume >= _MIN_VOL_RATIO * avg_vol)

        raw.append({
            "symbol": sym,
            "sector": _lts._symbol_sector(sym),
            "ltp": round(ltp, 2),
            "prev_close": round(pc, 2),
            "open_0915": round(open0, 2),
            "ret_pct": ret_pct,
            "ret_per_atr": ret_per_atr,
            "atr_pct": round(atr14 / pc * 100, 2) if (atr14 and pc) else None,
            "oi": oi_now,
            "oi_prev_close": oi_prev,
            "oi_chg_pct": oi_chg_pct,
            "quadrant": quad,
            "trend": _trend(ltp, h.get("sma20"), h.get("sma50"), h.get("closes_60d") or []),
            "above_vwap": above_vwap,
            "vwap": round(float(vwap), 2) if vwap else None,
            "day_high": round(float(q.get("high")), 2) if q.get("high") else None,
            "day_low": round(float(q.get("low")), 2) if q.get("low") else None,
            "volume": volume,
            "liquid": liquid,
            "extended": abs(ret_per_atr) > _EXTENDED_ATR,
        })

    nifty_ret = round(float(np.mean([r["ret_pct"] for r in raw])), 3) if raw else 0.0

    # Breadth verdict
    breadth = _compute_breadth(raw, nifty_ret, ist)
    verdict = breadth["verdict"]

    # Second pass — rel_strength + grade
    for r in raw:
        r["rel_strength"] = round(r["ret_pct"] - nifty_ret, 3)
        r["grade"] = _grade(r, verdict, state, mins)

    return {
        "as_of": ist.strftime("%Y-%m-%d %H:%M:%S"),
        "state": state,
        "session_date": st["session_date"],
        "data_mode": data_mode,
        "oi_live": bool(oi_live),
        "nifty_ret": nifty_ret,
        "rows": raw,
        "breadth": breadth,
        "quotes": quotes,
        "hist_keys": universe,
    }


def _compute_breadth(rows: list[dict[str, Any]], nifty_ret: float, ist: datetime) -> dict[str, Any]:
    n = len(rows)
    above = [r for r in rows if r.get("above_vwap")]
    pct_above = round(len(above) / n * 100, 1) if (n and any(r.get("above_vwap") is not None for r in rows)) else None
    adv = sum(1 for r in rows if r["ret_pct"] > 0)
    dec = sum(1 for r in rows if r["ret_pct"] < 0)
    adv_decl = round(adv / dec, 2) if dec else float(adv)

    # Risk-ON: pct_above_vwap>60 & nifty>0 & adv/decl>1.5 ; Risk-OFF mirror
    verdict = "NEUTRAL"
    if pct_above is not None and pct_above > 60 and nifty_ret > 0 and adv_decl > 1.5:
        verdict = "RISK_ON"
    elif pct_above is not None and pct_above < 40 and nifty_ret < 0 and adv_decl < 0.67:
        verdict = "RISK_OFF"

    if verdict == "RISK_ON":
        rationale = "Broad tape strong — longs enabled, shorts suppressed"
    elif verdict == "RISK_OFF":
        rationale = "Broad tape weak — shorts enabled, longs suppressed"
    else:
        rationale = "Mixed tape — A-grade only, half size"

    return {
        "as_of": ist.strftime("%Y-%m-%d %H:%M:%S"),
        "verdict": verdict,
        "pct_above_vwap": pct_above,
        "adv_decl": adv_decl,
        "advances": adv,
        "declines": dec,
        "nifty_from_0915": nifty_ret,
        "longs_enabled": verdict != "RISK_OFF",
        "shorts_enabled": verdict != "RISK_ON",
        "rationale": rationale,
    }


def _get_scan() -> dict[str, Any]:
    key = f"{_slot()}"
    cached = _scan_cache.get(key)
    if cached:
        return cached
    with _scan_lock:
        cached = _scan_cache.get(key)
        if cached:
            return cached
        result = _compute_scan()
        _scan_cache.clear()
        _scan_cache[key] = result
        return result


# ── Public API ────────────────────────────────────────────────────────────────
def get_universe() -> dict[str, Any]:
    scan = _get_scan()
    return {
        "as_of": scan["as_of"],
        "state": scan["state"],
        "session_date": scan["session_date"],
        "data_mode": scan["data_mode"],
        "oi_live": scan["oi_live"],
        "nifty_ret": scan["nifty_ret"],
        "rows": scan["rows"],
    }


def get_breadth() -> dict[str, Any]:
    scan = _get_scan()
    b = dict(scan["breadth"])
    b["state"] = scan["state"]
    return b


def get_normalized(symbols: Optional[list[str]] = None) -> dict[str, Any]:
    """Rebased-to-9:15 relative-strength lines: watchlist + NIFTY proxy + SECTOR.

    Sources live _iday ticks. Off-session (no ticks) returns empty with a note —
    the timing read is a session-only concept.
    """
    scan = _get_scan()
    rows = {r["symbol"]: r for r in scan["rows"]}

    # Default watchlist: graded rows, else top movers by |rel_strength|
    if not symbols:
        graded = [r["symbol"] for r in scan["rows"] if r["grade"]["grade"] != "NONE"]
        if graded:
            symbols = graded[:8]
        else:
            movers = sorted(scan["rows"], key=lambda r: abs(r["rel_strength"]), reverse=True)
            symbols = [r["symbol"] for r in movers[:8]]
    symbols = [s.upper() for s in symbols if s.upper() in rows]

    ist = _ist_now()
    with _lts._iday_lock:
        snap = {s: list(_lts._iday.get(s, [])) for s in symbols}
        universe_snap = {s: buf[-1][1] for s, buf in _lts._iday.items() if buf}

    all_times = sorted({t for buf in snap.values() for t, _ in buf}, key=_lts._t2m)
    if not all_times:
        return {
            "as_of": ist.strftime("%Y-%m-%d %H:%M:%S"),
            "state": scan["state"],
            "times": [],
            "series": {},
            "note": "Normalized lines populate from live 9:15 ticks during market hours.",
        }

    series: dict[str, list[float]] = {}
    for s in symbols:
        buf = snap.get(s, [])
        if not buf:
            continue
        base = buf[0][1]
        if not base:
            continue
        tick_map = {t: px for t, px in buf}
        pts, last = [], base
        for t in all_times:
            if t in tick_map:
                last = tick_map[t]
            pts.append(round((last / base - 1) * 100, 3))
        series[s] = pts

    # NIFTY proxy = equal-weight mean of normalized watchlist series per time
    if series:
        min_len = min(len(v) for v in series.values())
        series["NIFTY"] = [
            round(float(np.mean([v[i] for v in series.values()])), 3)
            for i in range(min_len)
        ]

    # SECTOR line = sector of the first watchlist symbol (relative-strength read)
    first = symbols[0] if symbols else None
    sec = rows.get(first, {}).get("sector") if first else None
    if sec:
        sec_syms = [s for s in _lts.SECTOR_MAP.get(sec, []) if s in snap and snap[s]]
        if sec_syms:
            sec_series = []
            for s in sec_syms:
                buf = snap[s]
                base = buf[0][1]
                if not base:
                    continue
                tick_map = {t: px for t, px in buf}
                pts, last = [], base
                for t in all_times:
                    if t in tick_map:
                        last = tick_map[t]
                    pts.append((last / base - 1) * 100)
                sec_series.append(pts)
            if sec_series:
                ml = min(len(x) for x in sec_series)
                series["SECTOR"] = [
                    round(float(np.mean([x[i] for x in sec_series])), 3) for i in range(ml)
                ]

    return {
        "as_of": ist.strftime("%Y-%m-%d %H:%M:%S"),
        "state": scan["state"],
        "times": all_times,
        "series": series,
        "note": None,
    }


def get_optionchain(symbol: str) -> dict[str, Any]:
    """ATM±3 strike ladder + front future — reuses the working get_stock_options."""
    st = resolve_market_state()
    data = _lts.get_stock_options(symbol.upper())
    if not data.get("is_fo"):
        return {"symbol": symbol.upper(), "is_fo": False, "state": st["state"], "strikes": []}
    data["state"] = st["state"]
    return data


def get_strike_chart(symbol: str, strike: float, expiry: str) -> dict[str, Any]:
    """FUT/CE/PE price + OI series for one strike — reuses get_strike_chart_data.

    Reshapes the {time, close}/{time, oi} bars into {time, value} ChartPoints.
    """
    d = _lts.get_strike_chart_data(symbol.upper(), float(strike), expiry)

    def _pts(bars: list[dict], key: str) -> list[dict]:
        return [{"time": b["time"], "value": float(b[key])} for b in bars]

    return {
        "symbol": symbol.upper(),
        "strike": float(strike),
        "expiry": expiry,
        "futures": _pts(d.get("futures", []), "close"),
        "futures_oi": _pts(d.get("futures_oi", []), "oi"),
        "ce": _pts(d.get("ce", []), "close"),
        "ce_oi": _pts(d.get("ce_oi", []), "oi"),
        "pe": _pts(d.get("pe", []), "close"),
        "pe_oi": _pts(d.get("pe_oi", []), "oi"),
        "futures_oi_now": d.get("futures_oi_now", 0),
        "ce_oi_now": d.get("ce_oi_now", 0),
        "pe_oi_now": d.get("pe_oi_now", 0),
    }


def invalidate() -> None:
    global _fut_meta_date
    with _scan_lock:
        _scan_cache.clear()
    with _fut_meta_lock:
        _fut_meta_date = ""
    # The scatter's price/return fields come from live_trading_service._get_hist(),
    # whose daily cache is NOT keyed on the underlying data date — so post-market
    # re-ingestion leaves it stale (serving the prior session). Reset it too, else
    # clearing only the fno caches re-derives from the same stale hist.
    _lts.invalidate()
    log.info("F&O tactical: caches invalidated")
