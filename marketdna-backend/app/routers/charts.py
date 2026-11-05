"""Live Charts page — F&O universe symbol list, OHLCV history, and live-tick websocket."""
import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services import fno_charts_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/charts", tags=["charts"])


@router.get("/symbols")
def get_symbols():
    """The F&O underlying-equity universe (~209 symbols) for the search/filter grid."""
    return fno_charts_service.get_symbols()


@router.get("/history")
def get_history(symbol: str, tf: str = "1d", interval: str = "1m"):
    """OHLCV candles for one F&O underlying.

    tf: one of 1d, 2d, 5d, 1mo, 3mo, ytd, 1y, 5y
    interval: candle resolution, only honored for tf='1d' -- '1m' (default) or '5m'.
    """
    return fno_charts_service.get_history(symbol, tf, interval)


@router.get("/indicators")
def get_indicators(tf: str = "1d"):
    """RSI(14) / ATR%(14) / period return% for every F&O symbol at one timeframe --
    powers the Charts/Chart Cart filter bar. Slow (~70s) on the first request for a
    given tf (209 Kite historical_data calls, rate-limited to 3 concurrent); fast on
    repeat requests within the cache TTL.
    """
    return fno_charts_service.get_indicators_snapshot(tf)


# Mounted without the /api prefix -- kept as its own router so the path is a
# clean /ws/charts rather than /api/charts/ws (websockets aren't REST resources).
ws_router = APIRouter()


@ws_router.websocket("/ws/charts")
async def ws_charts(websocket: WebSocket):
    """Streams every F&O underlying's latest tick once a second, from the
    in-process cache populated by fno_charts_service's KiteTicker callback.
    One combined message keeps the client in sync with a single connection
    rather than a websocket per stock.
    """
    await websocket.accept()
    try:
        while True:
            ticks = fno_charts_service.get_ticks()
            if ticks:
                await websocket.send_json({"ticks": ticks})
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        log.debug("charts websocket client disconnected")
    except Exception as exc:
        log.warning("charts websocket error: %s", exc)
