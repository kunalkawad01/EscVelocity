"""FastAPI router for the Postgres-backed personal Trading Rules page."""
from fastapi import APIRouter, HTTPException

from app.db import StoreUnavailable
from app.models.trading_rules import TradingRulesDoc
from app.services import trading_rules_store

router = APIRouter(prefix="/api/trading-rules", tags=["trading-rules"])


@router.get("", response_model=TradingRulesDoc | None)
def get_rules():
    """The saved rulebook, or null if nothing has been saved yet (client seeds its
    own defaults and PUTs them) or Postgres is unreachable (client falls back local)."""
    return trading_rules_store.get_doc()


@router.put("", response_model=TradingRulesDoc)
def save_rules(doc: TradingRulesDoc):
    """Replace the whole rulebook."""
    try:
        return trading_rules_store.save_doc(doc)
    except StoreUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Trading rules database unavailable: {exc}") from exc
