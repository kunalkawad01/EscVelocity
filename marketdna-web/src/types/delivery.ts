export interface SignalOccurrence {
  date: string
  ret_1d: number
  ret_1w: number
  ret_1m: number
  ret_1y: number | null
}

export interface DeliverySignalStats {
  occurrences: number
  avg_1d: number
  avg_1w: number
  avg_1m: number
  win_rate: number
  expected_value: number
  max_adverse: number
  distribution: Record<string, number>
  timeline: SignalOccurrence[]
  mkt_regime_high_win_rate: number | null
  mkt_regime_low_win_rate: number | null
  mkt_regime_high_ev: number | null
  mkt_regime_low_ev: number | null
  mkt_regime_high_occurrences: number
  mkt_regime_low_occurrences: number
}

export interface DeliverySignal {
  name: string
  description: string
  direction: string
  is_active: boolean
  current_delivery_pct: number
  current_vol_ratio: number
  grade: string
  edge_score: number
  stats: DeliverySignalStats
}

export interface DeliveryBar {
  date: string
  close: number
  volume: number
  delivery_pct: number
  vol_ratio: number
  delivery_spike: boolean
}

export interface DeliveryReport {
  symbol: string
  data_start: string
  data_end: string
  total_bars: number
  current_delivery_pct: number
  avg_delivery_pct_20d: number
  signals: DeliverySignal[]
  history: DeliveryBar[]
  computed_at: string
}

export interface DeliverySummaryItem {
  symbol: string
  current_delivery_pct: number
  avg_delivery_pct_20d: number
  delivery_ratio: number
  current_vol_ratio: number
  best_signal: string
  grade: string
  edge_score: number
  win_rate: number
  is_active: boolean
  mkt_regime_high_win_rate: number | null
  mkt_regime_low_win_rate: number | null
}

export interface DeliverySummaryResult {
  items: DeliverySummaryItem[]
  total_symbols: number
  computed_at: string
}

export const GRADE_COLOR: Record<string, string> = {
  'A+': '#22c55e', 'A': '#86efac', 'B': '#fbbf24', 'C': '#94a3b8', 'D': '#ef4444',
}

export const DIR_COLOR: Record<string, string> = {
  Bullish: '#22c55e', Bearish: '#ef4444', Mixed: '#fbbf24',
}

export const DIST_BUCKET_ORDER = ['<-10', '-10:-5', '-5:0', '0:5', '5:10', '>10']
