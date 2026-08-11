"""Nifty 50 index live state + contributors/detractors.

Points-contribution is a broker-style approximation, not NSE's exact divisor
methodology (which needs live free-float share counts we don't have access to):

    points_i = weight_i% * index_prev_close * change_pct_i%

See marketdna-data/nifty50_weights.csv for the weight table and its per-row
source/confidence (official NSE top-10 vs cross-referenced estimate).
"""
import logging
import time
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from app.services import live_trading_service
from app.services.duckdb_client import get_connection
from app.services.kite_client import get_kite

log = logging.getLogger(__name__)

# ── Historical chart ──────────────────────────────────────────────────────────
# label -> (Kite interval, lookback days). The three intraday-range buttons
# (daily/2day/5day) intentionally reuse minute-family intervals over a short
# window -- distinct from the plain 1min/5min/15min/30min interval buttons,
# which use a slightly longer default window so there's something to pan across.
TF_CONFIG: dict[str, tuple[str, int]] = {
    "1min":  ("minute", 2),
    "5min":  ("5minute", 5),
    "15min": ("15minute", 10),
    "30min": ("30minute", 20),
    "daily": ("minute", 1),
    "2day":  ("5minute", 2),
    "5day":  ("15minute", 5),
    "1m":    ("day", 30),
    "3m":    ("day", 90),
    "6m":    ("day", 180),
    "1y":    ("day", 365),
    "2y":    ("day", 730),
    "3y":    ("day", 1095),
    "5y":    ("day", 1825),
}
MAX_CHUNK_DAYS = 1900  # Kite hard limit is 2000 calendar days per historical_data() call

_token_cache: dict[str, int] = {}  # NSE tradingsymbol -> instrument_token
_history_cache: dict[tuple[str, str], tuple[float, dict]] = {}  # (symbol, tf) -> (fetched_at, response)
_HISTORY_CACHE_TTL: dict[str, int] = {
    "1min": 15, "5min": 15, "15min": 30, "30min": 30, "daily": 15, "2day": 30, "5day": 60,
}
_DEFAULT_TTL = 300  # daily-candle ranges (1m..5y) barely change intraday


def _get_token(symbol: str) -> int | None:
    """Resolve any NSE tradingsymbol's instrument_token -- the NIFTY 50 index
    ("NIFTY 50") and any of its equity constituents resolve the same way."""
    if symbol in _token_cache:
        return _token_cache[symbol]
    try:
        kite = get_kite()
        resp = kite.ltp([f"NSE:{symbol}"])
        q = next(iter(resp.values()), None)
        if q:
            _token_cache[symbol] = int(q["instrument_token"])
    except Exception as exc:
        log.warning("_get_token(%s) failed: %s", symbol, exc)
    return _token_cache.get(symbol)


def get_history(tf: str, symbol: str | None = None) -> dict:
    """OHLCV candles for the NIFTY 50 index (default) or a given constituent symbol.

    tf must be a key of TF_CONFIG. Cached per (symbol, tf) with a short TTL so
    switching tabs/stocks back and forth doesn't re-hit Kite on every click.
    """
    symbol = symbol or live_trading_service.NIFTY50_INDEX_SYMBOL
    if tf not in TF_CONFIG:
        return {"tf": tf, "symbol": symbol, "candles": [], "error": f"unknown timeframe '{tf}'"}

    cache_key = (symbol, tf)
    cached = _history_cache.get(cache_key)
    ttl = _HISTORY_CACHE_TTL.get(tf, _DEFAULT_TTL)
    if cached and (time.time() - cached[0]) < ttl:
        return cached[1]

    interval, days = TF_CONFIG[tf]
    token = _get_token(symbol)
    if not token:
        return {"tf": tf, "symbol": symbol, "candles": [], "error": f"could not resolve instrument token for '{symbol}'"}

    to_dt = datetime.now()
    from_dt = to_dt - timedelta(days=days)

    try:
        kite = get_kite()
        all_candles: list[dict] = []
        cursor = from_dt
        while cursor < to_dt:
            chunk_end = min(cursor + timedelta(days=MAX_CHUNK_DAYS), to_dt)
            all_candles.extend(kite.historical_data(token, cursor, chunk_end, interval))
            cursor = chunk_end + timedelta(seconds=1)

        candles = [
            {
                "time": c["date"].isoformat(),
                "open": c["open"], "high": c["high"], "low": c["low"], "close": c["close"],
                "volume": c.get("volume", 0),
            }
            for c in all_candles
        ]
        result = {"tf": tf, "symbol": symbol, "interval": interval, "candles": candles}
        _history_cache[cache_key] = (time.time(), result)
        return result
    except Exception as exc:
        log.warning("get_history(%s, %s) failed: %s", symbol, tf, exc)
        return {"tf": tf, "symbol": symbol, "candles": [], "error": str(exc)}


def get_index_state() -> Optional[dict]:
    """Live NIFTY 50 index tick: WebSocket if connected, else a one-off REST fallback.

    Returns None (not {}) when neither source has data -- see get_vix_state's
    docstring for why an empty dict is dangerous for a frontend truthy-guard.
    """
    tick = live_trading_service.get_nifty_index_tick()
    if tick:
        return {**tick, "source": "ws"}

    try:
        kite = get_kite()
        resp = kite.quote([f"NSE:{live_trading_service.NIFTY50_INDEX_SYMBOL}"])
        q = next(iter(resp.values()), None)
        if not q:
            return None
        ltp = float(q["last_price"])
        prev_close = float(q["ohlc"]["close"])
        change = ltp - prev_close if prev_close else 0.0
        change_pct = (change / prev_close * 100) if prev_close else 0.0
        return {
            "ltp": round(ltp, 2),
            "prev_close": round(prev_close, 2),
            "change": round(change, 2),
            "change_pct": round(change_pct, 3),
            "ts": datetime.now().isoformat(timespec="seconds"),
            "source": "rest",
        }
    except Exception as exc:
        log.warning("get_index_state: REST fallback failed -- %s", exc)
        return None


def _all_rows(idx: dict) -> list[dict]:
    """One row per tracked constituent with a live tick, in NIFTY50_WEIGHTS order
    (weight-descending, per nifty50_weights.csv)."""
    base = idx.get("prev_close") or idx.get("ltp") or 0.0
    ticks = live_trading_service.get_nifty_constituent_ticks()

    rows: list[dict] = []
    for sym, weight in live_trading_service.NIFTY50_WEIGHTS.items():
        t = ticks.get(sym)
        if not t or not base:
            continue
        pct = t.get("change_pct", 0.0)
        points = weight / 100 * base * pct / 100
        rows.append({
            "symbol": sym,
            "weight_pct": weight,
            "ltp": t["ltp"],
            "change_pct": pct,
            "points_contribution": round(points, 3),
        })
    return rows


def get_contributors(limit: int = 10) -> dict:
    """Top point contributors and detractors among Nifty 50 constituents."""
    idx = get_index_state()
    rows = _all_rows(idx)

    contributors = sorted(
        (r for r in rows if r["points_contribution"] > 0),
        key=lambda r: r["points_contribution"], reverse=True,
    )[:limit]
    detractors = sorted(
        (r for r in rows if r["points_contribution"] < 0),
        key=lambda r: r["points_contribution"],
    )[:limit]

    return {
        "index": idx,
        "contributors": contributors,
        "detractors": detractors,
        "n_tracked": len(rows),
        "n_total": len(live_trading_service.NIFTY50_WEIGHTS),
    }


# ── Top gainers/losers across lookback periods ────────────────────────────────
# All periods except 'daily' are computed from EOD closes (equities_prices) --
# they can only refresh once a day anyway, so they're cached per calendar date.
# 'daily' reuses the live tick change_pct (same source as the Contributors panel)
# so it stays live during market hours instead of lagging a full day behind.
_MOVERS_HIST_PERIODS = ("weekly", "1m", "3m", "ytd", "12m")
_movers_hist_cache: dict[str, dict] = {}  # date_str -> {"periods": {...}, "sma_breadth": {...}}


def _top_n(pct_map: dict[str, float], n: int, reverse: bool) -> list[dict]:
    items = sorted(pct_map.items(), key=lambda kv: kv[1], reverse=reverse)[:n]
    return [{"symbol": s, "change_pct": p} for s, p in items]


def _closest_close_on_or_before(series: list[tuple[str, float]], target_iso: str) -> float | None:
    """series is (date_iso, close) sorted ascending by date. Returns the close of
    the latest trading day at or before target_iso, or None if none exists."""
    result: float | None = None
    for d, c in series:
        if d <= target_iso:
            result = c
        else:
            break
    return result


def _breadth_label(score: float) -> str:
    if score >= 70: return "Broad Participation"
    if score >= 50: return "Moderate Breadth"
    if score >= 30: return "Narrow Breadth"
    return "Poor Breadth"


def _sma_breadth_from_series(sym_series: dict[str, list[tuple[str, float]]]) -> dict:
    """% of Nifty 50 constituents trading above SMA20/50/200, from the same
    closes already fetched for movers -- avoids a second DuckDB round-trip.
    Same 30/40/30 weighting as regime_service's breadth_score, but scoped to
    the 50 constituents (regime_service's own /api/regime/breadth is NSE-500-wide,
    which would read inconsistently against everything else on this page)."""
    count20 = count50 = count200 = total = 0
    for series in sym_series.values():
        closes = [c for _, c in series]
        if len(closes) < 20:
            continue
        total += 1
        latest = closes[-1]
        if latest > sum(closes[-20:]) / 20:
            count20 += 1
        if len(closes) >= 50 and latest > sum(closes[-50:]) / 50:
            count50 += 1
        if len(closes) >= 200 and latest > sum(closes[-200:]) / 200:
            count200 += 1

    pct20 = round(count20 / total * 100, 1) if total else 0.0
    pct50 = round(count50 / total * 100, 1) if total else 0.0
    pct200 = round(count200 / total * 100, 1) if total else 0.0
    score = round(pct20 * 0.30 + pct50 * 0.40 + pct200 * 0.30, 1)
    return {
        "pct_above_sma20": pct20, "pct_above_sma50": pct50, "pct_above_sma200": pct200,
        "count_above_sma20": count20, "count_above_sma50": count50, "count_above_sma200": count200,
        "total_symbols": total, "breadth_score": score, "breadth_label": _breadth_label(score),
    }


def _compute_movers_history() -> dict:
    """{"periods": {period: {symbol: change_pct}}, "sma_breadth": {...}} --
    everything derivable from one batch fetch of Nifty 50 EOD closes."""
    symbols = list(live_trading_service.NIFTY50_WEIGHTS.keys())
    symbols_sql = ", ".join(f"'{s}'" for s in symbols)

    con = get_connection()
    rows = con.execute(f"""
        SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)), close
        FROM equities_prices
        WHERE symbol IN ({symbols_sql})
          AND CAST(date AS DATE) >= CURRENT_DATE - INTERVAL 400 DAY
        ORDER BY symbol, date
    """).fetchall()

    sym_series: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for sym, d, c in rows:
        sym_series[sym].append((d, float(c)))

    today = datetime.now().date()
    targets: dict[str, str] = {
        "weekly": (today - timedelta(days=7)).isoformat(),
        "1m":     (today - timedelta(days=30)).isoformat(),
        "3m":     (today - timedelta(days=91)).isoformat(),
        "ytd":    f"{today.year - 1}-12-31",
        "12m":    (today - timedelta(days=365)).isoformat(),
    }

    period_pct: dict[str, dict[str, float]] = {p: {} for p in _MOVERS_HIST_PERIODS}
    for sym, series in sym_series.items():
        if not series:
            continue
        latest_close = series[-1][1]
        for period, target_iso in targets.items():
            base = _closest_close_on_or_before(series, target_iso)
            if base and base > 0:
                period_pct[period][sym] = round((latest_close - base) / base * 100, 3)

    return {"periods": period_pct, "sma_breadth": _sma_breadth_from_series(sym_series)}


def _get_movers_hist() -> dict:
    today_str = datetime.now().date().isoformat()
    hist = _movers_hist_cache.get(today_str)
    if hist is None:
        hist = _compute_movers_history()
        _movers_hist_cache.clear()
        _movers_hist_cache[today_str] = hist
    return hist


def get_period_movers() -> dict:
    """Top-5 gainers/losers among Nifty 50 constituents across 6 lookback periods:
    daily, weekly, 1m, 3m, ytd, 12m. Historical legs cached per calendar date;
    daily is recomputed each call from the already-cached live ticks."""
    hist = _get_movers_hist()

    ticks = live_trading_service.get_nifty_constituent_ticks()
    daily_pct = {
        sym: round(t["change_pct"], 3)
        for sym, t in ticks.items() if sym in live_trading_service.NIFTY50_WEIGHTS
    }

    periods_out = {"daily": {"gainers": _top_n(daily_pct, 5, True), "losers": _top_n(daily_pct, 5, False)}}
    for period in _MOVERS_HIST_PERIODS:
        pct_map = hist["periods"].get(period, {})
        periods_out[period] = {"gainers": _top_n(pct_map, 5, True), "losers": _top_n(pct_map, 5, False)}

    return {"periods": periods_out, "n_tracked": len(live_trading_service.NIFTY50_WEIGHTS)}


# ── Advance/decline among the 50 constituents (live) ──────────────────────────
def get_breadth() -> dict:
    """Live advances/declines/unchanged (from ticks) + % of the 50 above SMA20/50/200
    (from EOD closes, cached alongside movers) -- everything the breadth strip needs
    in one call, all scoped to the 50 constituents rather than the NSE-500-wide
    /api/regime/breadth."""
    ticks = live_trading_service.get_nifty_constituent_ticks()
    advances = declines = unchanged = 0
    for sym in live_trading_service.NIFTY50_WEIGHTS:
        t = ticks.get(sym)
        if not t:
            continue
        pct = t.get("change_pct", 0.0)
        if pct > 0:
            advances += 1
        elif pct < 0:
            declines += 1
        else:
            unchanged += 1
    total = advances + declines + unchanged

    hist = _get_movers_hist()
    return {
        "advances": advances,
        "declines": declines,
        "unchanged": unchanged,
        "adv_dec_ratio": round(advances / declines, 2) if declines > 0 else None,
        "total": total,
        "n_total": len(live_trading_service.NIFTY50_WEIGHTS),
        **hist["sma_breadth"],
    }


# ── India VIX live state ───────────────────────────────────────────────────────
VIX_SYMBOL = "INDIA VIX"


def get_vix_state() -> Optional[dict]:
    """Latest India VIX tick via REST (no persistent websocket for VIX -- it's
    polled on demand, unlike the NIFTY 50 index/constituent tick stream).

    Returns None (not {}) on any failure -- an empty dict is truthy in JS, so a
    frontend guard like `vix ? vix.ltp.toFixed(2) : '-'` would still try to read
    `.ltp` off it and crash the whole page on an undefined access.
    """
    try:
        kite = get_kite()
        resp = kite.quote([f"NSE:{VIX_SYMBOL}"])
        q = next(iter(resp.values()), None)
        if not q:
            return None
        ltp = float(q["last_price"])
        prev_close = float(q["ohlc"]["close"])
        change = ltp - prev_close if prev_close else 0.0
        change_pct = (change / prev_close * 100) if prev_close else 0.0
        return {
            "ltp": round(ltp, 2),
            "prev_close": round(prev_close, 2),
            "change": round(change, 2),
            "change_pct": round(change_pct, 3),
            "ts": datetime.now().isoformat(timespec="seconds"),
        }
    except Exception as exc:
        log.warning("get_vix_state failed: %s", exc)
        return None


# ── PCR / max-pain intraday trend (in-memory accumulator) ─────────────────────
# options_service.get_oi_analysis() serves the ingested parquet, which only
# changes when ingest_option_chain.py is rerun (batch/manual) -- so a PCR trend
# built off it was flatlining at a single point all session. Instead this pulls
# live OI for the whole ATM±20 chain via one batched kite.quote() call (~82
# instruments, well under the 500/call limit) each time it's polled, so PCR and
# max-pain actually move intraday. Resets on server restart and rolls over on
# date/expiry change, same tradeoff as live_trading_service's other in-process
# accumulators (e.g. _iday).
_pcr_history: list[dict] = []
_pcr_history_date = ""
_pcr_history_expiry = ""


def _live_pcr_snapshot(expiry: str | None) -> dict | None:
    """One batched kite.quote() over the full NIFTY chain -> live PCR/max-pain/spot.
    Falls back to None (caller keeps serving the existing series) on any failure."""
    from app.models.options import StrikeData
    from app.services import options_service

    chain = options_service.get_oi_analysis("NIFTY", expiry=expiry)
    if chain is None or not chain.strikes:
        return None

    try:
        kite = get_kite()
        tsym_map: dict[str, tuple[float, str]] = {}
        quote_keys: list[str] = []
        for s in chain.strikes:
            for opt in ("CE", "PE"):
                inst = live_trading_service._get_nfo_instrument("NIFTY", chain.expiry, s.strike, opt)
                if inst:
                    _, tsym = inst
                    qk = f"NFO:{tsym}"
                    quote_keys.append(qk)
                    tsym_map[qk] = (s.strike, opt)
        if not quote_keys:
            return None

        q_resp = kite.quote(quote_keys)
        live_oi: dict[tuple[float, str], int] = {}
        for qk, val in q_resp.items():
            mapping = tsym_map.get(qk)
            if mapping:
                live_oi[mapping] = int(val.get("oi") or 0)

        strike_list: list[StrikeData] = []
        total_ce = total_pe = 0
        for s in chain.strikes:
            ce_oi = live_oi.get((s.strike, "CE"), s.ce_oi)
            pe_oi = live_oi.get((s.strike, "PE"), s.pe_oi)
            total_ce += ce_oi
            total_pe += pe_oi
            strike_list.append(StrikeData(
                strike=s.strike, ce_oi=ce_oi, pe_oi=pe_oi,
                ce_volume=0, pe_volume=0, ce_ltp=0.0, pe_ltp=0.0,
            ))

        max_pain_strike, _ = options_service._compute_max_pain(strike_list)
        pcr = round(total_pe / total_ce, 3) if total_ce else None

        spot = chain.spot
        try:
            ltp_resp = kite.ltp([f"NSE:{live_trading_service.NIFTY50_INDEX_SYMBOL}"])
            inst = ltp_resp.get(f"NSE:{live_trading_service.NIFTY50_INDEX_SYMBOL}")
            if inst:
                spot = round(float(inst["last_price"]), 2)
        except Exception:
            pass

        return {"expiry": chain.expiry, "pcr": pcr, "max_pain": max_pain_strike, "spot": spot}
    except Exception as exc:
        log.warning("_live_pcr_snapshot failed: %s", exc)
        return None


def get_pcr_history(expiry: str | None = None) -> dict:
    """Live-snapshot NIFTY PCR/max-pain/spot, append to today's in-memory series,
    and return the full series."""
    global _pcr_history, _pcr_history_date, _pcr_history_expiry

    snap = _live_pcr_snapshot(expiry)
    if snap is None:
        return {"expiry": _pcr_history_expiry, "points": list(_pcr_history)}

    today_str = datetime.now().date().isoformat()
    if _pcr_history_date != today_str or _pcr_history_expiry != snap["expiry"]:
        _pcr_history = []
        _pcr_history_date = today_str
        _pcr_history_expiry = snap["expiry"]

    _pcr_history.append({
        "time": datetime.now().strftime("%H:%M:%S"),
        "pcr": snap["pcr"],
        "max_pain": snap["max_pain"],
        "spot": snap["spot"],
    })

    return {"expiry": snap["expiry"], "points": list(_pcr_history)}


def get_all_constituents(idx: dict | None = None) -> dict:
    """Every tracked constituent with a live tick, weight-descending -- the full
    50-stock board (not just top-N contributors/detractors). Pass an already-fetched
    index state to avoid re-fetching it (e.g. from the websocket loop)."""
    idx = idx if idx is not None else get_index_state()
    rows = _all_rows(idx)
    return {
        "index": idx,
        "constituents": rows,
        "n_tracked": len(rows),
        "n_total": len(live_trading_service.NIFTY50_WEIGHTS),
    }
