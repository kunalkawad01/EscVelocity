export interface SignalStats {
  occurrences: number
  avg_1w: number
  avg_2w: number
  avg_1m: number
  median_1m: number
  max_1m: number
  min_1m: number
  std_1m: number
  win_rate: number
  positive_prob: number
  negative_prob: number
  max_drawdown_1m: number
  distribution: Record<string, number>
  expected_value: number
  // Stock regime-conditional stats (null = < 5 occurrences in that bucket)
  regime_high_win_rate: number | null
  regime_low_win_rate: number | null
  regime_high_ev: number | null
  regime_low_ev: number | null
  regime_high_occurrences: number
  regime_low_occurrences: number
  // Market regime-conditional stats (avg regime across all 50 NIFTY stocks)
  mkt_regime_high_win_rate: number | null
  mkt_regime_low_win_rate: number | null
  mkt_regime_high_ev: number | null
  mkt_regime_low_ev: number | null
  mkt_regime_high_occurrences: number
  mkt_regime_low_occurrences: number
}

export interface ThresholdResult {
  threshold: number
  label: string
  occurrences: number
  avg_1m: number
  win_rate: number
  expected_value: number
}

export interface IndicatorEdgeResult {
  name: string
  signal: string
  category: string
  direction: string
  stats: SignalStats
  grade: string
  edge_score: number
  threshold_sweep: ThresholdResult[]
  best_threshold: ThresholdResult | null
  is_active: boolean
}

export interface CurrentSignal {
  indicator: string
  current_value: string
  signal_label: string
  is_active: boolean
  stats: SignalStats | null
}

export interface IndicatorEdgeReport {
  symbol: string
  data_start: string
  data_end: string
  total_bars: number
  results: IndicatorEdgeResult[]
  ranked_indicators: string[]
  best_indicator: string
  best_setup: string
  current_signals: CurrentSignal[]
  computed_at: string
}

export interface StockEdgeSummaryItem {
  symbol: string
  best_indicator: string
  best_signal: string
  grade: string
  direction: string
  edge_score: number
  win_rate: number
  avg_1m: number
  negative_prob: number
  max_drawdown_1m: number
  expected_value: number
  occurrences: number
  is_active: boolean
}

export interface StockEdgeSummaryResult {
  items: StockEdgeSummaryItem[]
  total_symbols: number
  computed_at: string
}

export const GRADE_COLOR: Record<string, string> = {
  'A+': '#22c55e',
  'A':  '#86efac',
  'B':  '#fbbf24',
  'C':  '#94a3b8',
  'D':  '#ef4444',
}

export const DIR_COLOR: Record<string, string> = {
  Bullish: '#22c55e',
  Bearish: '#ef4444',
  Mixed:   '#fbbf24',
}
