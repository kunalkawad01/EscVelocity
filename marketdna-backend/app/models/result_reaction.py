"""Result Reaction models — price behaviour around quarterly result dates."""
from pydantic import BaseModel


class QuarterReaction(BaseModel):
    result_date: str              # NSE board-meeting date, as announced (YYYY-MM-DD)
    reaction_date: str            # trading day used as "Day 0" (first trading day >= result_date)
    day_minus1_pct: float | None = None
    day0_pct: float | None = None
    day_plus1_pct: float | None = None


class SymbolResultReaction(BaseModel):
    symbol: str
    quarters: list[QuarterReaction] = []
    avg_day_minus1_pct: float | None = None
    avg_day0_pct: float | None = None
    avg_day_plus1_pct: float | None = None
    win_rate: float | None = None   # fraction of quarters where day0_pct > 0
    n_quarters: int = 0
    error: str | None = None        # set when NSE fetch / price lookup failed for this symbol


class ResultReactionScanResponse(BaseModel):
    items: list[SymbolResultReaction]
    ready: bool
    computed: int
    total: int
