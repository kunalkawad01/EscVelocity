export const SIGNAL_LABELS = ["Strong Buy", "Buy", "Neutral", "Sell", "Strong Sell"] as const
export type SignalLabel = typeof SIGNAL_LABELS[number]

export const SIGNAL_COLOR: Record<string, string> = {
  "Strong Buy":  "#22c55e",
  "Buy":         "#86efac",
  "Neutral":     "#94a3b8",
  "Sell":        "#f87171",
  "Strong Sell": "#ef4444",
}

export const RSI_SIGNAL_COLOR: Record<string, string> = {
  "Oversold":        "#22c55e",
  "Near Oversold":   "#86efac",
  "Neutral":         "#94a3b8",
  "Near Overbought": "#fbbf24",
  "Overbought":      "#ef4444",
}

export const TREND_COLOR: Record<string, string> = {
  "Fully Bullish":   "#22c55e",
  "Mostly Bullish":  "#86efac",
  "Mixed":           "#94a3b8",
  "Mostly Bearish":  "#f87171",
  "Fully Bearish":   "#ef4444",
}

export const BB_SIGNAL_COLOR: Record<string, string> = {
  "Below Lower Band": "#22c55e",
  "Near Lower Band":  "#86efac",
  "Mid Band":         "#94a3b8",
  "Near Upper Band":  "#fbbf24",
  "Above Upper Band": "#ef4444",
}

export const MACD_COLOR: Record<string, string> = {
  "Bullish": "#22c55e",
  "Bearish": "#ef4444",
  "None":    "#94a3b8",
}

export interface TrendReading {
  sma20: number
  sma50: number
  sma100: number
  sma200: number
  ema20: number
  ema50: number
  price_vs_sma20: number
  price_vs_sma50: number
  price_vs_sma100: number
  price_vs_sma200: number
  alignment_score: number
  trend_label: string
}

export interface MomentumReading {
  rsi14: number
  rsi_signal: string
  macd_line: number
  macd_signal: number
  macd_hist: number
  macd_crossover: string
  stoch_k: number
  stoch_d: number
  stoch_signal: string
}

export interface VolatilityReading {
  bb_upper: number
  bb_middle: number
  bb_lower: number
  bb_pct_b: number
  bb_signal: string
  atr14: number
  atr_pct: number
}

export interface VolumeReading {
  obv: number
  volume: number
  volume_sma20: number
  volume_ratio: number
  volume_signal: string
}

export interface IndicatorDivergence {
  type: string
  description: string
}

export interface StockIndicators {
  symbol: string
  date: string
  price: number
  trend: TrendReading
  momentum: MomentumReading
  volatility: VolatilityReading
  volume: VolumeReading
  divergences: IndicatorDivergence[]
  overall_signal: string
  signal_score: number
  computed_at: string
}

export interface IndicatorScanItem {
  symbol: string
  price: number
  rsi14: number
  rsi_signal: string
  macd_hist: number
  macd_crossover: string
  bb_pct_b: number
  bb_signal: string
  atr_pct: number
  volume_ratio: number
  trend_label: string
  alignment_score: number
  overall_signal: string
  signal_score: number
  signals: string[]
}

export interface IndicatorScanResult {
  items: IndicatorScanItem[]
  signal_distribution: Record<string, number>
  computed_at: string
}
