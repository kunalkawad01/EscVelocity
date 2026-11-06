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

from app.services.fno_tactical_service import _FO_SYMBOLS
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
ALL_TFS = ("1d", "2d", "5d", "1mo", "3mo", "ytd", "1y", "5y")

# Selectable candle resolution for the 1D tab only -- every other timeframe has a
# single fixed interval (see TF_CONFIG) appropriate to its own lookback window.
ONE_D_INTERVALS: dict[str, str] = {"1m": "minute", "5m": "5minute"}

_history_cache: dict[tuple[str, str, str], tuple[float, dict]] = {}  # (symbol, tf, interval) -> (fetched_at, response)
_HISTORY_TTL: dict[str, int] = {"1d": 15, "2d": 30, "5d": 60}
_DEFAULT_TTL = 300  # 1mo/3mo/ytd/1y/5y are daily candles -- barely change intraday

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
    """09:15 of the most recently started NSE session (today if it's a weekday
    and 09:15 has already passed, else the most recent prior weekday) -- used
    so the 1D tile begins exactly at today's open instead of bleeding into
    yesterday's candles via a rolling 24h lookback."""
    d = now.date()
    if now.weekday() >= 5 or now.hour * 60 + now.minute < 9 * 60 + 15:
        d -= timedelta(days=1)
        while d.weekday() >= 5:
            d -= timedelta(days=1)
    return datetime(d.year, d.month, d.day, 9, 15)


def get_history(symbol: str, tf: str, interval: str = "1m") -> dict:
    """OHLCV candles for one F&O underlying across the 8 Charts-page timeframes.

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
