"""Nifty 50 index router — live tick websocket, contributors/detractors, option-chain expiries."""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services import live_trading_service, nifty50_service

log = logging.getLogger(__name__)

NIFTY_OPTIONS_SYMBOL = "NIFTY"

router = APIRouter(prefix="/api/nifty50", tags=["nifty50"])


@router.get("/state")
def get_state():
    """Latest NIFTY 50 index tick (websocket if connected, else a REST fallback)."""
    return nifty50_service.get_index_state()


@router.get("/contributors")
def get_contributors(limit: int = 10):
    """Top point contributors and detractors among Nifty 50 constituents."""
    return nifty50_service.get_contributors(limit=limit)


@router.get("/constituents")
def get_constituents():
    """Every tracked Nifty 50 constituent with a live tick (the full board)."""
    return nifty50_service.get_all_constituents()


@router.get("/history")
def get_history(tf: str = "1m", symbol: Optional[str] = None):
    """OHLCV candles for the NIFTY 50 index (default) or a given constituent symbol.

    tf: one of 1min, 5min, 15min, 30min, daily, 2day, 5day, 1m, 3m, 6m, 1y, 2y, 3y, 5y
    symbol: NSE tradingsymbol, e.g. RELIANCE. Omit for the NIFTY 50 index itself.
    """
    return nifty50_service.get_history(tf, symbol=symbol)


@router.get("/movers")
def get_movers():
    """Top-5 gainers/losers among Nifty 50 constituents across 6 lookback periods
    (daily, weekly, 1m, 3m, ytd, 12m) -- for the bar-chart movers section."""
    return nifty50_service.get_period_movers()


@router.get("/breadth")
def get_breadth():
    """Live advance/decline + % of the 50 above SMA20/50/200, all scoped to
    Nifty 50 (not the NSE-500-wide /api/regime/breadth)."""
    return nifty50_service.get_breadth()


@router.get("/vix-state")
def get_vix_state():
    """Latest India VIX tick. History reuses /history?symbol=INDIA VIX."""
    return nifty50_service.get_vix_state()


@router.get("/pcr-history")
def get_pcr_history(expiry: Optional[str] = None):
    """Intraday PCR/max-pain/spot series for NIFTY, accumulated in-memory across polls."""
    return nifty50_service.get_pcr_history(expiry=expiry)


@router.get("/option-chain/expiries")
def get_option_chain_expiries():
    """The (up to 8) weekly expiries currently live on NFO for NIFTY index options.

    Reads Kite's live instrument list (via live_trading_service's daily NFO
    cache), not the last ingested options_chain partition -- so this stays
    correct all session even before that evening's post-market ingestion runs.
    """
    return {"expiries": live_trading_service.get_live_expiries(NIFTY_OPTIONS_SYMBOL)}


# Mounted without the /api prefix -- kept as its own router so the path is a
# clean /ws/nifty50 rather than /api/nifty50/ws (websockets aren't REST resources).
ws_router = APIRouter()


@ws_router.websocket("/ws/nifty50")
async def ws_nifty50(websocket: WebSocket):
    """Streams the index tick plus every tracked constituent's tick once a second,
    from the in-process cache populated by live_trading_service's KiteTicker callback.
    One combined message keeps the client in sync with a single connection rather
    than a websocket per stock.
    """
    await websocket.accept()
    try:
        while True:
            idx = nifty50_service.get_index_state()
            if idx:
                board = nifty50_service.get_all_constituents(idx)
                await websocket.send_json({
                    "index": idx,
                    "constituents": board["constituents"],
                })
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        log.debug("nifty50 websocket client disconnected")
    except Exception as exc:
        log.warning("nifty50 websocket error: %s", exc)
