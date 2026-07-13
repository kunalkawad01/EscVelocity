"""Pydantic models for MarketDNA Quant Portfolios (OHLCV-only baskets)."""
from typing import Literal, Optional

from pydantic import BaseModel, Field


class Criterion(BaseModel):
    label: str
    passed: bool
    value: float | None = None      # the underlying metric, for the "why" panel


class Holding(BaseModel):
    symbol: str
    name: str | None = None
    score: float                    # 0–100 composite
    weight: float | None = None     # normalized target weight (custom portfolios); None => equal
    reasons: list[str]              # criteria the stock passed (quick chips)
    checks: list[Criterion]         # full pass/fail list with values


class PortfolioMeta(BaseModel):
    key: str
    name: str
    description: str
    expected_holding: str
    rebalance: str
    volatility_stars: int           # 1–5
    is_custom: bool = False         # true => user-defined (editable/deletable)


class PortfolioListResponse(BaseModel):
    portfolios: list[PortfolioMeta]


class ScreenResponse(PortfolioMeta):
    universe: str                   # nifty200 | nifty500
    as_of: str
    count: int
    holdings: list[Holding]


class LiveHolding(BaseModel):
    symbol: str
    name: str | None = None
    ltp: float | None = None
    return_pct: float | None = None      # intraday (LIVE) or last-session (CLOSED) %


class LiveResponse(BaseModel):
    key: str
    name: str
    universe: str                        # nifty200 | nifty500
    state: str                           # LIVE | CLOSED | PRE_OPEN | HOLIDAY | ...
    state_label: str
    is_live: bool
    source: str                          # live | eod
    server_time: str | None = None
    as_of: str
    count: int
    basket_return_pct: float | None = None
    advancers: int
    decliners: int
    holdings: list[LiveHolding]


class NavPoint(BaseModel):
    date: str
    nav: float


class RebalEvent(BaseModel):
    date: str
    action: str                          # INCEPTION | ADD | DROP
    symbol: str
    rationale: str | None = None


class TrackHolding(BaseModel):
    symbol: str
    name: str | None = None
    weight_pct: float
    entry_close: float
    ltp: float | None = None
    since_entry_pct: float | None = None
    rationale: str | None = None
    ret_1d: float | None = None
    ret_1d_rank: float | None = None
    ret_5d: float | None = None
    ret_5d_rank: float | None = None
    ret_1m: float | None = None
    ret_1m_rank: float | None = None
    ret_3m: float | None = None
    ret_3m_rank: float | None = None
    ret_6m: float | None = None
    ret_6m_rank: float | None = None
    ret_1y: float | None = None
    ret_1y_rank: float | None = None


class TrackResponse(BaseModel):
    key: str
    name: str
    description: str
    universe: str                        # nifty200 | nifty500
    rebalance: str
    expected_holding: str
    volatility_stars: int
    inception_date: str
    as_of: str
    is_live: bool = False
    source: str = "eod"                  # live | eod
    current_nav: float
    total_return_pct: float
    days_live: int
    count: int
    equity_curve: list[NavPoint]
    holdings: list[TrackHolding]
    rebalance_log: list[RebalEvent]


# ── Custom (user-defined) portfolios ─────────────────────────────────────────
# A custom portfolio is defined entirely by rules (handwritten expressions over the
# feature fields) instead of a hard-coded Python screener. It plugs into the SAME
# screen / track / live / NAV machinery as the built-in portfolios.

WeightScheme = Literal["equal", "score", "inverse_vol", "by_field"]
EvictionWeight = Literal["redistribute", "hold_cash"]
RebalanceFreq = Literal["W", "M", "Q"]


class WeightSpec(BaseModel):
    scheme: WeightScheme = "equal"
    field: Optional[str] = None          # required when scheme == "by_field"


class PortfolioSpec(BaseModel):
    """User-defined portfolio: rules of formation + rebalance. Everything else
    (₹100 growth curve, performance, rebalance log) reuses the tracker engine."""
    key: str = Field(pattern=r"^[a-z0-9_]{3,40}$")
    name: str
    description: str = ""
    universe: str = "nifty500"
    expected_holding: str = "user-defined"
    volatility_stars: int = Field(default=3, ge=1, le=5)
    max_holdings: int = Field(default=20, ge=1, le=100)

    # Formation
    entry: str                            # boolean expression over feature fields ("core" must-haves)
    rank_by: str = "mom_score"            # numeric expression: ranks candidates + shown as 0-100 score
    weight: WeightSpec = WeightSpec()     # weight at formation (req #2)
    fill: Optional[str] = None            # optional pool to top-up from when entry yields < max_holdings
    fill_rank_by: Optional[str] = None    # how to order the fill pool (defaults to rank_by)

    # Intra-period eviction / stop-loss (req #3, #4)
    eviction: Optional[str] = None        # boolean expr; may use since_entry_pct, days_held
    eviction_weight: EvictionWeight = "redistribute"

    # Rebalance (req #5, #6, #7)
    rebalance_freq: RebalanceFreq = "M"
    rebalance: Optional[str] = None       # boolean expr; None => reuse `entry`
    rebalance_weight: WeightSpec = WeightSpec()

    created_at: Optional[str] = None
    is_custom: bool = True


class FieldInfo(BaseModel):
    """One selectable rule field, for the builder UI + validation catalog."""
    name: str
    label: str
    kind: str                             # numeric | boolean
    unit: Optional[str] = None
    group: Optional[str] = None
    position_only: bool = False           # true => only usable in eviction/stop-loss rules


class FieldCatalogResponse(BaseModel):
    fields: list[FieldInfo]
    operators: list[str]


class NLDraftRequest(BaseModel):
    """Plain-English description of a portfolio idea, to be translated into a rule spec."""
    description: str = Field(min_length=3, max_length=2000)
    universe: str = "nifty500"


class NLDraftResponse(BaseModel):
    """A draft PortfolioSpec produced from natural language. NOT saved — the user reviews
    the generated rules (and the live match preview) before creating it via POST /custom."""
    spec: PortfolioSpec                   # generated draft (key auto-slugged, editable)
    summary: str                          # plain-English readback of what the rules do
    warnings: list[str] = []              # e.g. no eviction rule, empty-screen risk
    preview_count: int = 0                # how many stocks the entry rule matches right now
    preview_symbols: list[str] = []       # first few current matches, for a sanity check
    attempts: int = 1                     # LLM passes incl. auto-repairs


class BacktestResponse(BaseModel):
    key: str
    name: str
    freq: str
    universe: str                   # nifty200 | nifty500
    periods: int
    years: float
    total_return_pct: float
    cagr_pct: float
    vol_pct: float
    sharpe: float | None
    sortino: float | None
    max_drawdown_pct: float
    hit_rate_pct: float
    alpha_pct: float | None
    best_period_pct: float
    worst_period_pct: float
    final_growth_of_100: float
    bench_growth_of_100: float
    equity_curve: dict[str, float]      # date -> growth of 100
    bench_curve: dict[str, float]
    monthly_returns: dict[str, float]   # 'YYYY-MM' -> return %
