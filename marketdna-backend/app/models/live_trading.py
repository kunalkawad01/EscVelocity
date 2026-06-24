from pydantic import BaseModel


class SectorPoint(BaseModel):
    sector: str
    return_pct: float
    atr_pct: float
    stock_count: int
    direction: str  # "long" | "short" | "neutral"


class SectorScatterResponse(BaseModel):
    as_of: str
    kite_live: bool
    data_mode: str  # "live" | "eod_fallback"
    nifty_return: float
    sectors: list[SectorPoint]


class ConstituentPoint(BaseModel):
    symbol: str
    return_pct: float
    atr_pct: float
    ltp: float
    direction: str


class IntradayPoint(BaseModel):
    time: str
    sector_return: float
    nifty_return: float


class MiniChart(BaseModel):
    symbol: str
    return_pct: float
    ltp: float
    direction: str
    sparkline: list[float]


class SectorProgressionPoint(BaseModel):
    time: str
    return_pct: float


class SectorDrillDownResponse(BaseModel):
    sector: str
    as_of: str
    data_mode: str
    return_pct: float
    atr_pct: float
    vs_nifty: float
    short_bias: bool
    current_correlation: float
    constituents: list[ConstituentPoint]
    intraday_progression: list[IntradayPoint]
    intraday_progression_source: str | None = None
    stock_progressions: dict[str, list[SectorProgressionPoint]] | None = None
    mini_charts: list[MiniChart]
    correlation_history: list[float]
    correlation_times: list[str]


class SMAData(BaseModel):
    above_sma20: bool
    above_sma50: bool
    above_sma200: bool
    sma20: float | None
    sma50: float | None
    sma200: float | None


class StockIntelligenceResponse(BaseModel):
    symbol: str
    as_of: str
    data_mode: str
    bias: str  # "long" | "short" | "neutral"
    bias_rationale: str
    ltp: float
    prev_close: float
    return_pct: float
    vwap: float | None
    above_vwap: bool
    prev_high: float | None
    prev_low: float | None
    above_prev_high: bool
    below_prev_low: bool
    sma: SMAData
    sector: str | None
    sector_rank: int | None
    sector_total: int | None
    universe_rank: int | None
    universe_total: int
    sparkline_intraday: list[float]
    sparkline_5d: list[float]
    sparkline_20d: list[float]
    sparkline_60d: list[float]
    drawdown_1w: float
    drawdown_1m: float
    drawdown_3m: float
    drawdown_1y: float
    high_52w: float | None
    low_52w: float | None
    pct_from_52w_high: float | None
    pct_from_52w_low: float | None


class WhyNowCard(BaseModel):
    id: str
    direction: str  # "long" | "short"
    symbol: str
    signal_type: str
    time: str  # "HH:MM"
    what_happening: str
    why_matters: str
    confirm_trigger: str
    invalidate_trigger: str
    entry: float
    target: float
    stop: float
    risk_reward: float
    target_pct: float
    stop_pct: float
    priority: int


class BreakthroughSignalsResponse(BaseModel):
    as_of: str
    kite_live: bool
    data_mode: str
    signal_count: int
    signals: list[WhyNowCard]


class StockChartBar(BaseModel):
    t: str
    o: float | None
    h: float | None
    l: float | None
    c: float | None
    v: int
    sma20: float | None
    sma50: float | None
    sma200: float | None
    dd: float


class TFRank(BaseModel):
    return_pct: float | None
    universe_rank: int | None
    universe_total: int
    sector_rank: int | None
    sector_total: int


class StockChartResponse(BaseModel):
    symbol: str
    bars: list[StockChartBar]
    ranks_tf: dict[str, TFRank]


class IntradayBar(BaseModel):
    time: str   # "HH:MM"
    open: float
    high: float
    low: float
    close: float
    volume: int = 0


class StockIntradayResponse(BaseModel):
    symbol: str
    source: str   # "live" | "1min_kite"
    ltp: float | None = None
    bars: list[IntradayBar]
    vwap: float | None = None
    prev_high: float | None = None
    prev_low: float | None = None
    prev_close: float | None = None
    volume_ratio: float | None = None   # today_vol / avg_vol20
    pct_52w_high: float | None = None  # (ltp - 52w_high) / 52w_high * 100 (negative = below)


class OptionStrikeRow(BaseModel):
    strike: float
    is_atm: bool
    ce_ltp: float
    ce_iv: float | None = None
    ce_oi: int
    pe_ltp: float
    pe_iv: float | None = None
    pe_oi: int
    pcr: float | None = None    # pe_oi / ce_oi for this strike
    oi_total: int = 0           # ce_oi + pe_oi (used for gamma wall)


class StockOptionsResponse(BaseModel):
    symbol: str
    is_fo: bool
    spot: float | None = None
    expiry: str | None = None
    lot_size: int | None = None
    atm_strike: float | None = None
    straddle: float | None = None
    upper_be: float | None = None
    lower_be: float | None = None
    strikes: list[OptionStrikeRow] = []
    total_pcr: float | None = None    # sum(pe_oi) / sum(ce_oi) across all strikes
    gamma_wall: float | None = None   # strike with max(ce_oi + pe_oi)
    error: str | None = None


class LiveBreadthResponse(BaseModel):
    as_of: str
    advances: int
    declines: int
    unchanged: int
    adv_dec_ratio: float | None = None   # advances / declines
    total: int


class StrikeBar(BaseModel):
    time: str
    close: float


class OIPoint(BaseModel):
    time: str
    oi: int


class StrikeChartResponse(BaseModel):
    symbol: str
    strike: float
    expiry: str
    futures: list[StrikeBar] = []
    ce: list[StrikeBar] = []
    pe: list[StrikeBar] = []
    futures_oi: list[OIPoint] = []
    ce_oi: list[OIPoint] = []
    pe_oi: list[OIPoint] = []
    futures_oi_now: int = 0
    ce_oi_now: int = 0
    pe_oi_now: int = 0


class SectorProgressionsResponse(BaseModel):
    trade_date: str                                       # last trading day used as data source
    source: str                                           # "live" | "15min_kite" | "none"
    progressions: dict[str, list[SectorProgressionPoint]]  # sector → time-series
