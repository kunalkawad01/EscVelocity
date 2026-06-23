import os
# Must be set before numpy/scipy/sklearn are imported to prevent MKL from
# spawning child processes on Windows (causes backend hangs).
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")

from pathlib import Path

from dotenv import load_dotenv

# Load .env before any service modules are imported
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import assistant, stock, patterns, markov_options, quant_strategies, indicators, regime, cointegration, delivery, short, dataviz, dataviz_analytics, dataviz_breadth_extra, stock_health, randomness, options, breakout, live_trading, intraday_race, druckenmiller_roc, sector_heatmap, intelligence
from app.services.cointegration_service import start_preload
from app.services import validation_service
from app.services import stock_health_service
from app.services import indicators_service, indicator_edge_service
from app.services import regime_service
from app.services import delivery_service
from app.services import pattern_service
from app.services.pattern_service import start_screener_prewarm
from app.services import breakout_service
from app.services import live_trading_service

app = FastAPI(
    title="MarketDNA API",
    description="Quantitative market intelligence for Indian equities",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stock.router)
app.include_router(assistant.router)
app.include_router(patterns.router)
app.include_router(markov_options.router)
app.include_router(quant_strategies.router)
app.include_router(indicators.router)
app.include_router(regime.router)
app.include_router(cointegration.router)
app.include_router(delivery.router)
app.include_router(short.router)
app.include_router(dataviz.router)
app.include_router(dataviz_analytics.router)
app.include_router(dataviz_breadth_extra.router)
app.include_router(stock_health.router)
app.include_router(randomness.router)
app.include_router(options.router)
app.include_router(breakout.router)
app.include_router(live_trading.router)
app.include_router(intraday_race.router)
app.include_router(druckenmiller_roc.router)
app.include_router(sector_heatmap.router)
app.include_router(intelligence.router)

log = __import__("logging").getLogger(__name__)


def _run_task(name: str, fn) -> None:
    import time
    try:
        log.info("prewarm: %s ...", name)
        t0 = time.time()
        fn()
        log.info("prewarm: %s done in %.1fs", name, time.time() - t0)
    except Exception as exc:
        log.warning("prewarm: %s failed -- %s", name, exc)


def _background_prewarm() -> None:
    """Non-critical heavy tasks run in background after server is ready."""
    import time
    for name, fn in [
        ("cointegration",    start_preload),              # ~3s, user-visible page
        ("screener prewarm", start_screener_prewarm),    # ~3min, all 9 pattern tabs
        ("health scan",      stock_health_service.start_scan_warmup),
        ("indicator edge",   indicator_edge_service.get_edge_summary),
        ("validation suite", validation_service.run_full_validation),
    ]:
        _run_task(name, fn)
        time.sleep(0.5)


@app.on_event("startup")
async def startup():
    """Critical caches loaded synchronously before server accepts connections.

    DuckDB serializes concurrent queries on the shared in-memory connection —
    running these in background threads would cause the first 30-40s of foreground
    requests to block waiting for the prewarm DuckDB queries to complete.
    Running them here (before uvicorn begins serving) avoids that entirely.
    Server startup takes ~40s but all pages are immediately responsive after.
    """
    import threading
    for name, fn in [
        ("market regime series", regime_service.get_market_regime_series),
        ("delivery data",        delivery_service._load_delivery_data),
        ("delivery reports",     delivery_service.preload_all_reports),
        ("regime snapshot",      regime_service.get_snapshot),
        ("indicators scan",      indicators_service.get_scan),
        ("pattern scanner",      pattern_service.get_scanner),
        ("breakout levels",      breakout_service._get_historical_levels),
        ("live trading hist",    live_trading_service._get_hist),
    ]:
        _run_task(name, fn)
    threading.Thread(target=_background_prewarm, daemon=True).start()


@app.get("/health")
def health():
    return {"status": "ok"}
