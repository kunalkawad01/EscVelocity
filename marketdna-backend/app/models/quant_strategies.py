"""Pydantic models for the four quantitative strategy modules."""
from pydantic import BaseModel


# ─── Cross-Sectional Momentum ─────────────────────────────────────────────────

class MomentumItem(BaseModel):
    symbol: str
    sector: str
    ret_12_1m: float       # 12-1 month skip-one momentum return %
    ret_3m: float
    ret_1m: float
    rank: int              # 1 = strongest momentum
    quintile: int          # 1 = top 20%, 5 = bottom 20%
    signal: str            # "Strong Long" | "Long" | "Neutral" | "Avoid" | "Strong Avoid"
    options_strategy: str

class MomentumResult(BaseModel):
    items: list[MomentumItem]
    top_5: list[str]
    bottom_5: list[str]
    as_of: str


# ─── Mean Reversion Z-Score ───────────────────────────────────────────────────

class MeanReversionItem(BaseModel):
    symbol: str
    sector: str
    z_score_20d: float     # (close - SMA20) / std20
    z_score_50d: float
    bb_pct_b: float        # Bollinger Band %B  0=lower, 1=upper
    rsi: float
    reversion_score: float # composite −100 to +100  (positive = overbought)
    signal: str            # "Overbought" | "Near OB" | "Neutral" | "Near OS" | "Oversold"
    options_strategy: str

class MeanReversionResult(BaseModel):
    items: list[MeanReversionItem]
    overbought: list[str]  # signal == "Overbought"
    oversold: list[str]    # signal == "Oversold"
    as_of: str


# ─── Realized Volatility Rank ─────────────────────────────────────────────────

class VolRankItem(BaseModel):
    symbol: str
    sector: str
    hv20: float            # current annualised 20-day HV %
    hv20_1m_ago: float     # HV20 one month ago
    hv_rank: float         # percentile 0–100 vs trailing 252-day HV20 history
    vol_trend: str         # "Rising" | "Falling" | "Stable"
    regime: str            # "Very Low" | "Low" | "Normal" | "Elevated" | "High"
    options_strategy: str
    iv_action: str         # "Sell" | "Buy" | "Neutral"

class VolRankResult(BaseModel):
    items: list[VolRankItem]
    sell_candidates: list[str]   # hv_rank ≥ 70
    buy_candidates: list[str]    # hv_rank ≤ 30
    as_of: str


# ─── Sector Relative Strength Rotation ───────────────────────────────────────

class SectorItem(BaseModel):
    sector: str
    symbols: list[str]
    n_stocks: int
    ret_1m: float          # equal-weighted sector 1M return %
    ret_3m: float
    rs_1m: float           # sector ret_1m − NIFTY ret_1m
    rs_3m: float
    rank_3m: int           # 1 = strongest sector
    phase: str             # "Leading" | "Weakening" | "Lagging" | "Improving"

class SectorRotationResult(BaseModel):
    sectors: list[SectorItem]
    nifty_ret_1m: float
    nifty_ret_3m: float
    leading: list[str]
    improving: list[str]
    weakening: list[str]
    lagging: list[str]
    as_of: str


# ─── Combined scan result ─────────────────────────────────────────────────────

class QuantScanResult(BaseModel):
    momentum: MomentumResult
    mean_reversion: MeanReversionResult
    vol_rank: VolRankResult
    sector_rotation: SectorRotationResult
    computed_at: str
