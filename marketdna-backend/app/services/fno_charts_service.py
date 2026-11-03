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
from datetime import datetime, timedelta
from typing import Optional

from app.services.fno_tactical_service import _FO_SYMBOLS
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

_history_cache: dict[tuple[str, str], tuple[float, dict]] = {}  # (symbol, tf) -> (fetched_at, response)
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


def get_history(symbol: str, tf: str) -> dict:
    """OHLCV candles for one F&O underlying across the 8 Charts-page timeframes.

    Cached per (symbol, tf) with a short TTL for the intraday buckets (1d/2d/5d)
    so switching tabs back and forth across the 3-column grid doesn't re-hit Kite
    on every click; the daily-candle buckets (1mo..5y) barely change intraday.
    """
    symbol = symbol.upper()
    if tf not in ALL_TFS:
        return {"tf": tf, "symbol": symbol, "candles": [], "error": f"unknown timeframe '{tf}'"}

    cache_key = (symbol, tf)
    cached = _history_cache.get(cache_key)
    ttl = _HISTORY_TTL.get(tf, _DEFAULT_TTL)
    if cached and (time.time() - cached[0]) < ttl:
        return cached[1]

    token = _get_token(symbol)
    if not token:
        return {"tf": tf, "symbol": symbol, "candles": [], "error": f"could not resolve instrument token for '{symbol}'"}

    to_dt = datetime.now()
    if tf == YTD_TF:
        interval = "day"
        from_dt = datetime(to_dt.year, 1, 1)
    else:
        interval, days = TF_CONFIG[tf]
        from_dt = to_dt - timedelta(days=days)

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
        result = {"tf": tf, "symbol": symbol, "interval": interval, "candles": candles}
        _history_cache[cache_key] = (time.time(), result)
        return result
    except Exception as exc:
        log.warning("get_history(%s, %s) failed: %s", symbol, tf, exc)
        return {"tf": tf, "symbol": symbol, "candles": [], "error": str(exc)}


# ── Kite WebSocket ticker — all ~209 F&O underlyings ──────────────────────────
_tick_lock = threading.Lock()
_fo_ticks: dict[str, dict] = {}       # symbol -> {ltp, prev_close, change, change_pct, ts}
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
            prev_close = float((t.get("ohlc") or {}).get("close") or 0)
            change = ltp - prev_close if prev_close else 0.0
            change_pct = (change / prev_close * 100) if prev_close else 0.0
            _fo_ticks[sym] = {
                "ltp": round(ltp, 2),
                "prev_close": round(prev_close, 2),
                "change": round(change, 2),
                "change_pct": round(change_pct, 3),
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
