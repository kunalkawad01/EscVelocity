export interface SectorPoint {
  sector: string
  return_pct: number
  atr_pct: number
  stock_count: number
  direction: 'long' | 'short' | 'neutral'
}

export interface SectorScatterResponse {
  as_of: string
  kite_live: boolean
  data_mode: 'live' | 'eod_fallback'
  nifty_return: number
  sectors: SectorPoint[]
}

export interface ConstituentPoint {
  symbol: string
  return_pct: number
  atr_pct: number
  ltp: number
  direction: 'long' | 'short'
}

export interface IntradayPoint {
  time: string
  sector_return: number
  nifty_return: number
}

export interface MiniChart {
  symbol: string
  return_pct: number
  ltp: number
  direction: 'long' | 'short'
  sparkline: number[]
}

export interface SectorDrillDownResponse {
  sector: string
  as_of: string
  data_mode: 'live' | 'eod_fallback'
  return_pct: number
  atr_pct: number
  vs_nifty: number
  short_bias: boolean
  current_correlation: number
  constituents: ConstituentPoint[]
  intraday_progression: IntradayPoint[]
  intraday_progression_source: 'live' | '15min_kite'
  stock_progressions?: Record<string, SectorProgressionPoint[]>
  mini_charts: MiniChart[]
  correlation_history: number[]
  correlation_times: string[]
}

export interface SMAData {
  above_sma20: boolean
  above_sma50: boolean
  above_sma200: boolean
  sma20: number | null
  sma50: number | null
  sma200: number | null
}

export interface StockIntelligenceResponse {
  symbol: string
  as_of: string
  data_mode: 'live' | 'eod_fallback'
  bias: 'long' | 'short' | 'neutral'
  bias_rationale: string
  ltp: number
  prev_close: number
  return_pct: number
  vwap: number | null
  above_vwap: boolean
  prev_high: number | null
  prev_low: number | null
  above_prev_high: boolean
  below_prev_low: boolean
  sma: SMAData
  sector: string | null
  sector_rank: number | null
  sector_total: number | null
  universe_rank: number | null
  universe_total: number
  sparkline_intraday: number[]
  sparkline_5d: number[]
  sparkline_20d: number[]
  sparkline_60d: number[]
  drawdown_1w: number
  drawdown_1m: number
  drawdown_3m: number
  drawdown_1y: number
  high_52w: number | null
  low_52w: number | null
  pct_from_52w_high: number | null
  pct_from_52w_low: number | null
}

export interface WhyNowCard {
  id: string
  direction: 'long' | 'short'
  symbol: string
  signal_type: string
  time: string
  what_happening: string
  why_matters: string
  confirm_trigger: string
  invalidate_trigger: string
  entry: number
  target: number
  stop: number
  risk_reward: number
  target_pct: number
  stop_pct: number
  priority: number
}

export interface BreakthroughSignalsResponse {
  as_of: string
  kite_live: boolean
  data_mode: 'live' | 'eod_fallback'
  signal_count: number
  signals: WhyNowCard[]
}

export interface SectorProgressionPoint {
  time: string
  return_pct: number
}

export interface SectorProgressionsResponse {
  trade_date: string
  source: 'live' | '15min_kite' | 'none'
  progressions: Record<string, SectorProgressionPoint[]>
}

export interface StockChartBar {
  t: string
  o: number | null
  h: number | null
  l: number | null
  c: number | null
  v: number
  sma20: number | null
  sma50: number | null
  sma200: number | null
  dd: number
}

export interface TFRank {
  return_pct: number | null
  universe_rank: number | null
  universe_total: number
  sector_rank: number | null
  sector_total: number
}

export interface StockChartResponse {
  symbol: string
  bars: StockChartBar[]
  ranks_tf: Record<string, TFRank>
}
