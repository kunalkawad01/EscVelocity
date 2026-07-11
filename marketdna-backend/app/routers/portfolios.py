"""FastAPI router for Quant Portfolios (OHLCV-only 'smallcase for traders')."""
import logging

from fastapi import APIRouter, HTTPException, Query

from app.models.portfolios import (
    PortfolioListResponse, PortfolioMeta, ScreenResponse, BacktestResponse, LiveResponse,
    TrackResponse, PortfolioSpec, FieldCatalogResponse,
)
from app.services import portfolios_service
from app.services import portfolios_tracker_service
from app.services import portfolios_rules
from app.services import portfolios_store

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/portfolios", tags=["portfolios"])

_UNIVERSES = {"nifty200", "nifty500"}


def _norm_universe(universe: str) -> str:
    u = (universe or "").lower().strip()
    return u if u in _UNIVERSES else "nifty500"


@router.get("/list", response_model=PortfolioListResponse)
def list_portfolios():
    """All available quant portfolios with their metadata."""
    return {"portfolios": [PortfolioMeta(**p) for p in portfolios_service.list_portfolios()]}


@router.post("/invalidate")
def invalidate():
    """Clear portfolio caches (call after EOD ingestion)."""
    portfolios_service.invalidate_cache()
    return {"status": "ok", "message": "Portfolio cache cleared"}


# ── Custom (user-defined) portfolios ─────────────────────────────────────────
def _meta(p) -> PortfolioMeta:
    return PortfolioMeta(key=p.key, name=p.name, description=p.description,
                         expected_holding=p.expected_holding, rebalance=p.rebalance,
                         volatility_stars=p.volatility, is_custom=getattr(p, "is_custom", False))


@router.get("/custom/fields", response_model=FieldCatalogResponse)
def custom_fields():
    """Field catalog + operators for the rule builder. Position fields are flagged
    `position_only` (usable only in eviction/stop-loss rules)."""
    return {"fields": portfolios_rules.field_catalog("eviction"),
            "operators": portfolios_rules._CATALOG_OPERATORS}


@router.get("/custom/{key}/spec", response_model=PortfolioSpec)
def get_custom_spec(key: str):
    """Fetch a custom portfolio's rule spec (for editing)."""
    spec = portfolios_store.get_spec(key.lower())
    if spec is None:
        raise HTTPException(status_code=404, detail=f"No custom portfolio '{key}'")
    return spec


@router.post("/custom", response_model=PortfolioMeta, status_code=201)
def create_custom(spec: PortfolioSpec):
    """Create a user-defined portfolio from rules. Validates every rule before saving."""
    key = spec.key.lower()
    spec.key = key
    if key in portfolios_service.PORTFOLIOS:
        raise HTTPException(status_code=409, detail=f"'{key}' is a built-in portfolio key")
    if portfolios_store.get_spec(key) is not None:
        raise HTTPException(status_code=409, detail=f"Custom portfolio '{key}' already exists")
    try:
        portfolios_store.save_spec(spec)
    except portfolios_rules.RuleError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    portfolios_service.invalidate_cache()
    return _meta(portfolios_service.get_portfolio(key))


@router.put("/custom/{key}", response_model=PortfolioMeta)
def update_custom(key: str, spec: PortfolioSpec):
    """Replace a custom portfolio's rules. Rules are re-validated; caches are cleared."""
    key = key.lower()
    spec.key = key
    if portfolios_store.get_spec(key) is None:
        raise HTTPException(status_code=404, detail=f"No custom portfolio '{key}'")
    try:
        portfolios_store.save_spec(spec)
    except portfolios_rules.RuleError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    portfolios_service.invalidate_cache()
    return _meta(portfolios_service.get_portfolio(key))


@router.delete("/custom/{key}")
def delete_custom(key: str):
    """Delete a custom portfolio and purge its tracker history (basis / NAV / log)."""
    key = key.lower()
    if not portfolios_store.delete_spec(key):
        raise HTTPException(status_code=404, detail=f"No custom portfolio '{key}'")
    removed = portfolios_tracker_service.purge(key)
    portfolios_service.invalidate_cache()
    return {"status": "ok", "deleted": key, "purged": removed}


@router.get("/screen/{key}", response_model=ScreenResponse)
def screen(key: str, size: int | None = None,
           universe: str = Query("nifty500", description="nifty200 | nifty500")):
    """Run a portfolio screen: holdings with 0-100 score and full explainability."""
    try:
        return portfolios_service.get_screen(
            key.lower(), size=size, universe=_norm_universe(universe))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/track/{key}", response_model=TrackResponse)
def track(key: str, universe: str = Query("nifty500", description="nifty200 | nifty500")):
    """Forward paper-portfolio track: growth-of-₹100 curve from inception, rebalance log,
    and holdings with trailing returns (1D/5D/1M/3M/6M/1Y) + in-universe percentile ranks."""
    try:
        return portfolios_tracker_service.get_track(key.lower(), universe=_norm_universe(universe))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/track/snapshot")
def track_snapshot():
    """Persist an EOD NAV point for every portfolio × universe. Add to the post-market
    job AFTER equities ingestion so today's bar is present in equities_prices."""
    return portfolios_tracker_service.snapshot_all()


@router.get("/live/{key}", response_model=LiveResponse)
def live(key: str, universe: str = Query("nifty500", description="nifty200 | nifty500")):
    """Live (or last-session) mark-to-market of a portfolio's current basket.

    Fixed holdings between rebalances; per-holding return is (LTP / prev_close - 1)
    while the market is LIVE, else (last_close / prev_close - 1) from DuckDB.
    Not cached — poll this ~5s from the client while state == LIVE.
    """
    try:
        return portfolios_service.get_live(key.lower(), universe=_norm_universe(universe))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/backtest/{key}", response_model=BacktestResponse)
def backtest(key: str, freq: str = "M", start: str | None = None,
             end: str | None = None, size: int | None = None,
             universe: str = Query("nifty500", description="nifty200 | nifty500")):
    """Walk-forward backtest of a portfolio (freq = W | M | Q)."""
    try:
        return portfolios_service.get_backtest(
            key.lower(), freq=freq, start=start, end=end, size=size,
            universe=_norm_universe(universe))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
