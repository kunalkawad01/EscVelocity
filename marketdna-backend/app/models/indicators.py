"""Pydantic models for Technical Indicator Analysis."""
from pydantic import BaseModel


class TrendReading(BaseModel):
    sma20: float
    sma50: float
    sma100: float
    sma200: float
    ema20: float
    ema50: float
    price_vs_sma20: float
    price_vs_sma50: float
    price_vs_sma100: float
    price_vs_sma200: float
    alignment_score: int        # 0–4 (count of SMAs price is above)
    trend_label: str            # "Fully Bullish" | "Mostly Bullish" | "Mixed" | "Mostly Bearish" | "Fully Bearish"


class MomentumReading(BaseModel):
    rsi14: float
    rsi_signal: str             # "Oversold" | "Near Oversold" | "Neutral" | "Near Overbought" | "Overbought"
    macd_line: float
    macd_signal: float
    macd_hist: float
    macd_crossover: str         # "Bullish" | "Bearish" | "None"
    stoch_k: float
    stoch_d: float
    stoch_signal: str           # "Overbought" | "Oversold" | "Neutral"


class VolatilityReading(BaseModel):
    bb_upper: float
    bb_middle: float
    bb_lower: float
    bb_pct_b: float             # 0–100; 0 = at/below lower band, 100 = at/above upper band
    bb_signal: str
    atr14: float
    atr_pct: float              # ATR as % of price


class VolumeReading(BaseModel):
    obv: float
    volume: float
    volume_sma20: float
    volume_ratio: float         # current / 20d avg
    volume_signal: str          # "High Volume" | "Low Volume" | "Normal"


class IndicatorDivergence(BaseModel):
    type: str
    description: str


class StockIndicators(BaseModel):
    symbol: str
    date: str
    price: float
    trend: TrendReading
    momentum: MomentumReading
    volatility: VolatilityReading
    volume: VolumeReading
    divergences: list[IndicatorDivergence]
    overall_signal: str         # "Strong Buy" | "Buy" | "Neutral" | "Sell" | "Strong Sell"
    signal_score: float
    computed_at: str


class IndicatorScanItem(BaseModel):
    symbol: str
    price: float
    rsi14: float
    rsi_signal: str
    macd_hist: float
    macd_crossover: str
    bb_pct_b: float
    bb_signal: str
    atr_pct: float
    volume_ratio: float
    trend_label: str
    alignment_score: int
    overall_signal: str
    signal_score: float
    signals: list[str]


class IndicatorScanResult(BaseModel):
    items: list[IndicatorScanItem]
    signal_distribution: dict[str, int]
    computed_at: str
