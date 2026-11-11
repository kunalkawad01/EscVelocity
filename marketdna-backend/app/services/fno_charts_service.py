"""Live Charts page — F&O universe mini candlestick grid.

Reuses fno_tactical_service's FO.csv-sourced symbol list (~209 names) and follows
the exact live-tick pattern already proven in live_trading_service/nifty50_service
(one persistent KiteTicker, MODE_FULL, on_ticks -> in-process dict, FastAPI
websocket polling that dict once/sec) rather than inventing a new transport.

This opens its OWN KiteTicker connection (separate from the NIFTY 50 one in
live_trading_service) — Zerodha allows multiple simultaneous ticker connections
per app and a single socket comfortably holds ~209 instruments (limit is in the
thousands), so there's no need to multiplex onto the existing NIFTY 50 socket or
shard across connections.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Optional

import numpy as np

from app.services.duckdb_client import get_connection
from app.services.fno_tactical_service import _FO_SYMBOLS, _is_trading_day
from app.services.indicators_service import _rsi, _atr
from app.services.kite_client import get_kite

log = logging.getLogger(__name__)

# ── Timeframe buttons (label -> Kite interval, lookback days) ─────────────────
# 'ytd' has no fixed day-count (depends on today's date) so it's resolved
# specially in get_history() rather than living in this table.
TF_CONFIG: dict[str, tuple[str, int]] = {
    "1d":  ("minute", 1),
    "2d":  ("5minute", 2),
    "5d":  ("15minute", 5),
    "1mo": ("day", 30),
    "3mo": ("day", 90),
    "1y":  ("day", 365),
    "5y":  ("day", 1825),
}
YTD_TF = "ytd"
YESTERDAY_TF = "yesterday"
ALL_TFS = ("1d", "yesterday", "2d", "5d", "1mo", "3mo", "ytd", "1y", "5y")

# Selectable candle resolution for the 1D tab only -- every other timeframe has a
# single fixed interval (see TF_CONFIG) appropriate to its own lookback window.
ONE_D_INTERVALS: dict[str, str] = {"1m": "minute", "5m": "5minute"}

_history_cache: dict[tuple[str, str, str], tuple[float, dict]] = {}  # (symbol, tf, interval) -> (fetched_at, response)
_HISTORY_TTL: dict[str, int] = {"1d": 15, "2d": 30, "5d": 60}
_DEFAULT_TTL = 300  # 1mo/3mo/ytd/1y/5y are daily candles -- barely change intraday

# Intraday candles for one SPECIFIC past date (not a relative "N days back" window)
# -- used by Result Reaction to show the actual intraday shape of each reaction day
# around a quarterly result. A closed trading day's candles never change, so this
# is cached far longer than the relative-tf buckets above.
_date_history_cache: dict[tuple[str, str, str], tuple[float, dict]] = {}  # (symbol, date, interval) -> (fetched_at, response)
_DATE_HISTORY_TTL = 24 * 3600

_token_cache: dict[str, int] = {}  # NSE tradingsymbol -> instrument_token
_token_lock = threading.Lock()


def get_symbols() -> dict:
    """The F&O underlying-equity universe for the Charts page search/grid."""
    syms = sorted(_FO_SYMBOLS)
    return {"symbols": syms, "n": len(syms)}


def _resolve_tokens(symbols: list[str]) -> dict[str, int]:
    """Batch-resolve tradingsymbol -> instrument_token via kite.ltp(), chunked at
    200/call. Populates and returns from _token_cache; skips symbols already cached."""
    missing = [s for s in symbols if s not in _token_cache]
    if not missing:
        return {s: _token_cache[s] for s in symbols if s in _token_cache}

    kite = get_kite()
    with _token_lock:
        missing = [s for s in missing if s not in _token_cache]  # re-check post-lock
        for i in range(0, len(missing), 200):
            chunk = missing[i : i + 200]
            try:
                resp = kite.ltp([f"NSE:{s}" for s in chunk])
            except Exception as exc:
                log.warning("_resolve_tokens: chunk starting %s failed -- %s", chunk[0], exc)
                continue
            for key, val in resp.items():
                sym = key.replace("NSE:", "")
                _token_cache[sym] = int(val["instrument_token"])

    return {s: _token_cache[s] for s in symbols if s in _token_cache}


def _get_token(symbol: str) -> Optional[int]:
    if symbol in _token_cache:
        return _token_cache[symbol]
    return _resolve_tokens([symbol]).get(symbol)


def _session_start(now: datetime) -> datetime:
    """09:15 of the most recently started NSE session (today if it's a trading
    day and 09:15 has already passed, else the most recent prior trading day) --
    used so the 1D tile begins exactly at today's open instead of bleeding into
    yesterday's candles via a rolling 24h lookback. Skips weekends AND NSE
    holidays (_is_trading_day) -- a plain weekday check alone mislabels a
    holiday as the current session and returns an empty/malformed candle set."""
    d = now.date()
    if not _is_trading_day(d) or now.hour * 60 + now.minute < 9 * 60 + 15:
        d -= timedelta(days=1)
        while not _is_trading_day(d):
            d -= timedelta(days=1)
    return datetime(d.year, d.month, d.day, 9, 15)


def _prev_session_bounds(now: datetime) -> tuple[datetime, datetime]:
    """09:15->15:30 of the trading day immediately before the current session
    (see _session_start) -- the 'Yesterday' tab's fixed lookback window. Always a
    fully-completed session (never today), so the close bound is always 15:30
    rather than "now". Skips weekends AND NSE holidays."""
    cur_session_date = _session_start(now).date()
    d = cur_session_date - timedelta(days=1)
    while not _is_trading_day(d):
        d -= timedelta(days=1)
    return datetime(d.year, d.month, d.day, 9, 15), datetime(d.year, d.month, d.day, 15, 30)


def get_history(symbol: str, tf: str, interval: str = "1m") -> dict:
    """OHLCV candles for one F&O underlying across the 9 Charts-page timeframes
    (adds 'yesterday' -- the prior completed trading session only, 09:15-15:30,
    fixed Kite interval '5minute' -- used by the Live Screener's 6-timeframe
    expanded view; not a tab on the /charts tile grid itself).

    `interval` ('1m'/'5m') only applies to tf='1d' -- lets a trader switch the live
    1D tab between 1-minute and 5-minute candles. Every other timeframe ignores it
    and uses its own fixed Kite interval (see TF_CONFIG).

    Cached per (symbol, tf, interval) with a short TTL for the intraday buckets
    (1d/2d/5d) so switching tabs back and forth across the 3-column grid doesn't
    re-hit Kite on every click; the daily-candle buckets (1mo..5y) barely change
    intraday.
    """
    symbol = symbol.upper()
    if tf not in ALL_TFS:
        return {"tf": tf, "symbol": symbol, "candles": [], "error": f"unknown timeframe '{tf}'"}

    cache_key = (symbol, tf, interval if tf == "1d" else "")
    cached = _history_cache.get(cache_key)
    ttl = _HISTORY_TTL.get(tf, _DEFAULT_TTL)
    if cached and (time.time() - cached[0]) < ttl:
        return cached[1]

    token = _get_token(symbol)
    if not token:
        return {"tf": tf, "symbol": symbol, "candles": [], "error": f"could not resolve instrument token for '{symbol}'"}

    to_dt = datetime.now()
    if tf == YTD_TF:
        kite_interval = "day"
        from_dt = datetime(to_dt.year, 1, 1)
    elif tf == "1d":
        kite_interval = ONE_D_INTERVALS.get(interval, "minute")
        from_dt = _session_start(to_dt)
    elif tf == YESTERDAY_TF:
        kite_interval = "5minute"
        from_dt, to_dt = _prev_session_bounds(to_dt)
    else:
        kite_interval, days = TF_CONFIG[tf]
        from_dt = to_dt - timedelta(days=days)

    try:
        kite = get_kite()
        raw = kite.historical_data(token, from_dt, to_dt, kite_interval)
        candles = [
            {
                "time": c["date"].isoformat(),
                "open": c["open"], "high": c["high"], "low": c["low"], "close": c["close"],
                "volume": c.get("volume", 0),
            }
            for c in raw
        ]
        result = {"tf": tf, "symbol": symbol, "interval": kite_interval, "candles": candles}
        _history_cache[cache_key] = (time.time(), result)
        return result
    except Exception as exc:
        log.warning("get_history(%s, %s) failed: %s", symbol, tf, exc)
        return {"tf": tf, "symbol": symbol, "candles": [], "error": str(exc)}


def get_history_for_date(symbol: str, date_str: str, interval: str = "5minute") -> dict:
    """Intraday candles for one explicit past trading date (YYYY-MM-DD), 09:15-15:30.

    Generalizes get_history()'s 'yesterday' branch (_prev_session_bounds) to an
    arbitrary date instead of always-the-prior-session -- Result Reaction needs
    the actual intraday shape of Day 0 through Day +5 around a quarterly result,
    which are specific historical dates, not a relative lookback window.

    Kite's minute-level historical_data has been verified to go back 12+ months
    (checked empirically against RELIANCE -- see page_docu/result_reaction_page.md),
    so this works for all 4 quarters the scan covers, not just the most recent one.
    """
    symbol = symbol.upper()
    cache_key = (symbol, date_str, interval)
    cached = _date_history_cache.get(cache_key)
    if cached and (time.time() - cached[0]) < _DATE_HISTORY_TTL:
        return cached[1]

    token = _get_token(symbol)
    if not token:
        return {"symbol": symbol, "date": date_str, "candles": [], "error": f"could not resolve instrument token for '{symbol}'"}

    try:
        d = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return {"symbol": symbol, "date": date_str, "candles": [], "error": f"invalid date '{date_str}'"}
    from_dt = datetime(d.year, d.month, d.day, 9, 15)
    to_dt = datetime(d.year, d.month, d.day, 15, 30)

    try:
        kite = get_kite()
        raw = kite.historical_data(token, from_dt, to_dt, interval)
        candles = [
            {
                "time": c["date"].isoformat(),
                "open": c["open"], "high": c["high"], "low": c["low"], "close": c["close"],
                "volume": c.get("volume", 0),
            }
            for c in raw
        ]
        result = {"symbol": symbol, "date": date_str, "interval": interval, "candles": candles}
        _date_history_cache[cache_key] = (time.time(), result)
        return result
    except Exception as exc:
        log.warning("get_history_for_date(%s, %s) failed: %s", symbol, date_str, exc)
        return {"symbol": symbol, "date": date_str, "candles": [], "error": str(exc)}


# ── Indicator snapshot (RSI / ATR% / Returns%) for the filter bar ─────────────
# Reuses indicators_service's existing RSI/ATR formulas (same ones /indicators uses)
# rather than re-deriving them. Computed per-timeframe, over the exact same candle
# series get_history() already caches, so a snapshot is only a full Kite scan on the
# first cold request for a given tf -- every (symbol, tf) history fetch underneath it
# hits _history_cache on repeat calls, same TTLs as the Charts page tiles themselves.
_indicators_cache: dict[str, tuple[float, dict]] = {}  # tf -> (fetched_at, response)
_INDICATORS_MAX_WORKERS = 3  # Kite's historical_data endpoint is rate-limited ~3 req/s


def _compute_indicators_one(symbol: str, tf: str, tick: Optional[dict]) -> tuple[str, Optional[dict]]:
    hist = get_history(symbol, tf)
    candles = hist.get("candles") or []
    if len(candles) < 15:
        return symbol, None

    closes = np.array([c["close"] for c in candles], dtype=float)
    highs = np.array([c["high"] for c in candles], dtype=float)
    lows = np.array([c["low"] for c in candles], dtype=float)

    rsi_val = float(_rsi(closes)[-1])
    atr_val = float(_atr(highs, lows, closes)[-1])
    last_close = closes[-1]

    atr_pct = round(atr_val / last_close * 100, 2) if last_close and not np.isnan(atr_val) else None

    # Returns: for 1D, "prev close -> last price" (the conventional, gap-inclusive day
    # change% -- same number the tile header and live tick show), not "today's candle
    # open -> last price". A stock that gapped up overnight on news and then traded flat
    # intraday has a near-zero open-to-close move despite a large day change% -- using
    # the candle-open baseline here silently excluded exactly those gap-driven movers
    # from a "Returns > X" filter. For every other timeframe there's no single "previous
    # close" baseline that means anything (what's "previous close" for a 1Y window?), so
    # the period's own first candle open remains the right baseline there.
    if tf == "1d" and tick and tick.get("prev_close"):
        base = tick["prev_close"]
        last = tick.get("ltp") or last_close
    else:
        base = candles[0]["open"]
        last = last_close
    return_pct = round((last - base) / base * 100, 2) if base else None

    return symbol, {
        "rsi": None if np.isnan(rsi_val) else round(rsi_val, 2),
        "atr_pct": atr_pct,
        "return_pct": return_pct,
    }


def get_indicators_snapshot(tf: str) -> dict:
    """RSI(14) / ATR(14)-as-%-of-price / period return% for every F&O symbol at one
    timeframe, in one bulk response -- powers the Charts/Chart Cart filter bar without
    209 individual client-side history fetches just to filter the grid."""
    if tf not in ALL_TFS:
        return {"tf": tf, "indicators": {}, "error": f"unknown timeframe '{tf}'"}

    cached = _indicators_cache.get(tf)
    ttl = _HISTORY_TTL.get(tf, _DEFAULT_TTL)
    if cached and (time.time() - cached[0]) < ttl:
        return cached[1]

    symbols = sorted(_FO_SYMBOLS)
    ticks = get_ticks()
    indicators: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=_INDICATORS_MAX_WORKERS) as ex:
        futures = [ex.submit(_compute_indicators_one, s, tf, ticks.get(s)) for s in symbols]
        for fut in futures:
            try:
                sym, val = fut.result()
            except Exception as exc:
                log.warning("get_indicators_snapshot(%s): a symbol failed -- %s", tf, exc)
                continue
            if val is not None:
                indicators[sym] = val

    result = {
        "tf": tf,
        "indicators": indicators,
        "computed_at": datetime.now().isoformat(timespec="seconds"),
    }
    _indicators_cache[tf] = (time.time(), result)
    return result


# ── Reference-open snapshot (noise-reduced "open") ─────────────────────────────
# The raw 09:15 open print can be choppy -- the opening auction / first minute or
# two of algo activity often prints a value the stock doesn't hold. This exposes
# "price at HH:MM" (e.g. 09:18) as an alternative open reference for the Live
# Screener's open-based columns/filters (From Open %, Give-back %, Recovery %,
# Low/High vs Open %), computed from the same 1D 1-minute candle series
# get_history() already caches -- reuses it rather than a second Kite call shape.
_REF_OPEN_CACHE: dict[str, tuple[float, dict]] = {}  # "HH:MM" -> (fetched_at, response)
_REF_OPEN_TTL = 120  # the reference is effectively frozen once the session passes HH:MM


def _reference_open_one(symbol: str, minute: str) -> Optional[float]:
    hist = get_history(symbol, "1d", "1m")
    candles = hist.get("candles") or []
    for c in candles:
        # c["time"] is an ISO timestamp with the Asia/Kolkata offset, e.g.
        # "2026-11-07T09:18:00+05:30" -- slicing out HH:MM avoids a datetime
        # parse + tz-compare per candle for what's otherwise a plain string match.
        if c["time"][11:16] >= minute:
            return c["open"]
    return None  # today's session hasn't reached `minute` yet for this symbol


def get_reference_open_snapshot(minute: str = "09:18") -> dict:
    """Bulk 'price at HH:MM' for every F&O symbol today, in one response -- powers
    the Live Screener's 9:15-vs-9:18(or other) open-reference toggle without 209
    individual client-side history fetches. Slow (~70s) cold since it still needs
    one Kite historical_data call per symbol under get_history(); fast on repeat
    calls within the TTL, and free for any symbol whose (symbol, '1d', '1m') entry
    is already warm from the Charts page / indicator scan.
    """
    cached = _REF_OPEN_CACHE.get(minute)
    if cached and (time.time() - cached[0]) < _REF_OPEN_TTL:
        return cached[1]

    symbols = sorted(_FO_SYMBOLS)
    opens: dict[str, float] = {}
    with ThreadPoolExecutor(max_workers=_INDICATORS_MAX_WORKERS) as ex:
        futures = {ex.submit(_reference_open_one, s, minute): s for s in symbols}
        for fut, sym in futures.items():
            try:
                v = fut.result()
            except Exception as exc:
                log.warning("get_reference_open_snapshot(%s): %s failed -- %s", minute, sym, exc)
                continue
            if v is not None:
                opens[sym] = round(v, 2)

    result = {
        "minute": minute,
        "opens": opens,
        "computed_at": datetime.now().isoformat(timespec="seconds"),
    }
    _REF_OPEN_CACHE[minute] = (time.time(), result)
    return result


# ── Bulk historical return-percentile bands + SMA (Live Screener filter) ──────
# Per-symbol 5-year return-percentile breakpoints (intraday open->close AND
# close-to-close) plus latest SMA20/50/100/200, across the whole F&O universe in
# ONE grouped DuckDB query -- powers the Live Screener's "vs own percentile"
# filter mode (e.g. "vs Yday Close < this stock's own 25th percentile" -- an
# unusually weak day for THAT stock specifically, not a fixed % cutoff that
# means something different for a low-vol vs high-vol name) and its
# vs-SMA20/50/100/200 filter fields. Pure local DuckDB aggregation, not a Kite
# call, so this is fast (a single grouped scan) even cold -- nothing like the
# per-symbol Kite historical_data cost of get_reference_open_snapshot.
_PCTL_BANDS_CACHE: dict[int, tuple[float, dict]] = {}  # years -> (fetched_at, response)
_PCTL_BANDS_TTL = 3600  # 5y percentile bands + SMA barely move intraday


def get_percentile_bands(years: int = 5) -> dict:
    cached = _PCTL_BANDS_CACHE.get(years)
    if cached and (time.time() - cached[0]) < _PCTL_BANDS_TTL:
        return cached[1]

    con = get_connection()
    cutoff = (datetime.now().date() - timedelta(days=365 * years))
    symbols = sorted(_FO_SYMBOLS)

    df = con.execute("""
        WITH base AS (
            SELECT symbol, CAST(date AS DATE) AS d, open, close,
                LAG(close) OVER (PARTITION BY symbol ORDER BY CAST(date AS DATE)) AS prev_close,
                ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY CAST(date AS DATE) DESC) AS rn_desc
            FROM equities_prices
            WHERE symbol = ANY(?) AND CAST(date AS DATE) >= ?
        ),
        rets AS (
            SELECT symbol, rn_desc, close,
                (close - open) / NULLIF(open, 0) * 100 AS intraday_ret,
                CASE WHEN prev_close IS NOT NULL
                     THEN (close - prev_close) / NULLIF(prev_close, 0) * 100 END AS cc_ret
            FROM base
            WHERE open IS NOT NULL
        )
        SELECT symbol, COUNT(*) AS n,
            MIN(intraday_ret) AS i_min,
            QUANTILE_CONT(intraday_ret, 0.25) AS i_p25,
            QUANTILE_CONT(intraday_ret, 0.50) AS i_p50,
            QUANTILE_CONT(intraday_ret, 0.75) AS i_p75,
            QUANTILE_CONT(intraday_ret, 0.90) AS i_p90,
            MAX(intraday_ret) AS i_max,
            MIN(cc_ret) AS c_min,
            QUANTILE_CONT(cc_ret, 0.25) AS c_p25,
            QUANTILE_CONT(cc_ret, 0.50) AS c_p50,
            QUANTILE_CONT(cc_ret, 0.75) AS c_p75,
            QUANTILE_CONT(cc_ret, 0.90) AS c_p90,
            MAX(cc_ret) AS c_max,
            AVG(CASE WHEN rn_desc <= 20 THEN close END) AS sma20,
            AVG(CASE WHEN rn_desc <= 50 THEN close END) AS sma50,
            AVG(CASE WHEN rn_desc <= 100 THEN close END) AS sma100,
            AVG(CASE WHEN rn_desc <= 200 THEN close END) AS sma200
        FROM rets
        GROUP BY symbol
    """, [symbols, cutoff]).pl()

    def _r(v: Optional[float], dp: int = 3) -> Optional[float]:
        return round(float(v), dp) if v is not None else None

    stats: dict[str, dict] = {}
    for row in df.to_dicts():
        stats[row["symbol"]] = {
            "n": row["n"],
            "intraday": {
                "min": _r(row["i_min"]), "p25": _r(row["i_p25"]), "p50": _r(row["i_p50"]),
                "p75": _r(row["i_p75"]), "p90": _r(row["i_p90"]), "max": _r(row["i_max"]),
            },
            "closeToClose": {
                "min": _r(row["c_min"]), "p25": _r(row["c_p25"]), "p50": _r(row["c_p50"]),
                "p75": _r(row["c_p75"]), "p90": _r(row["c_p90"]), "max": _r(row["c_max"]),
            },
            "sma": {
                "sma20": _r(row["sma20"], 2), "sma50": _r(row["sma50"], 2),
                "sma100": _r(row["sma100"], 2), "sma200": _r(row["sma200"], 2),
            },
        }

    result = {
        "years": years,
        "stats": stats,
        "computed_at": datetime.now().isoformat(timespec="seconds"),
    }
    _PCTL_BANDS_CACHE[years] = (time.time(), result)
    return result


# ── Kite WebSocket ticker — all ~209 F&O underlyings ──────────────────────────
_tick_lock = threading.Lock()
_fo_ticks: dict[str, dict] = {}       # symbol -> {ltp, prev_close, change, change_pct, open, high, low, ts}
_fo_token_symbol: dict[int, str] = {}  # instrument_token -> symbol
_ticker = None  # KiteTicker instance, module singleton


def _on_fo_ticks(ws, ticks: list[dict]) -> None:
    now_iso = datetime.now().isoformat(timespec="seconds")
    with _tick_lock:
        for t in ticks:
            sym = _fo_token_symbol.get(t.get("instrument_token"))
            if sym is None:
                continue
            ltp = float(t.get("last_price") or 0)
            ohlc = t.get("ohlc") or {}
            # Kite's MODE_FULL "ohlc" block is {open, high, low} for TODAY's session
            # plus "close" for the PREVIOUS day -- same quirk the rest of this file
            # already relies on for prev_close/gap-inclusive returns.
            prev_close = float(ohlc.get("close") or 0)
            day_open = float(ohlc.get("open") or 0)
            day_high = float(ohlc.get("high") or 0)
            day_low = float(ohlc.get("low") or 0)
            change = ltp - prev_close if prev_close else 0.0
            change_pct = (change / prev_close * 100) if prev_close else 0.0
            _fo_ticks[sym] = {
                "ltp": round(ltp, 2),
                "prev_close": round(prev_close, 2),
                "change": round(change, 2),
                "change_pct": round(change_pct, 3),
                "open": round(day_open, 2),
                "high": round(day_high, 2),
                "low": round(day_low, 2),
                "ts": now_iso,
            }


def start_ticker() -> None:
    """Connect a persistent KiteTicker for the full F&O underlying universe.

    Runs on the _background_prewarm daemon thread; KiteTicker.connect(threaded=True)
    spawns its own internal thread for the socket loop, so this call returns
    immediately. Any failure (stale access token, no network) is logged and
    swallowed -- the Charts page falls back to REST history-only (no live overlay)
    and is otherwise unaffected.
    """
    global _ticker
    try:
        from kiteconnect import KiteTicker
        from dotenv import dotenv_values
        from app.config import settings

        env = dotenv_values(settings.data_path / ".env")
        api_key = env.get("KITE_API_KEY", "")
        access_token = env.get("KITE_ACCESS_TOKEN", "")
        if not api_key or not access_token:
            log.warning("fno_charts start_ticker: missing Kite credentials, skipping WS connect")
            return

        token_symbol = {tok: sym for sym, tok in _resolve_tokens(list(_FO_SYMBOLS)).items()}
        if not token_symbol:
            log.warning("fno_charts start_ticker: could not resolve any F&O instrument tokens, skipping WS connect")
            return

        with _tick_lock:
            _fo_token_symbol.clear()
            _fo_token_symbol.update(token_symbol)

        def _on_connect(ws, response):
            tokens = list(token_symbol.keys())
            ws.subscribe(tokens)
            ws.set_mode(ws.MODE_FULL, tokens)
            log.info("F&O charts ticker connected, subscribed to %d instruments", len(tokens))

        def _on_close(ws, code, reason):
            log.warning("F&O charts ticker closed: %s %s", code, reason)

        def _on_error(ws, code, reason):
            log.warning("F&O charts ticker error: %s %s", code, reason)

        kws = KiteTicker(api_key, access_token)
        kws.on_ticks = _on_fo_ticks
        kws.on_connect = _on_connect
        kws.on_close = _on_close
        kws.on_error = _on_error
        kws.connect(threaded=True)
        _ticker = kws
    except Exception as exc:
        log.warning("fno_charts start_ticker: failed to start Kite WebSocket -- %s", exc)


def stop_ticker() -> None:
    """Close the KiteTicker connection cleanly (called on FastAPI shutdown)."""
    global _ticker
    if _ticker is not None:
        try:
            _ticker.close()
        except Exception as exc:
            log.debug("fno_charts stop_ticker: close failed -- %s", exc)
        _ticker = None


def get_ticks() -> dict[str, dict]:
    """Latest per-symbol ticks, keyed by symbol."""
    with _tick_lock:
        return dict(_fo_ticks)
