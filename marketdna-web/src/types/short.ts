export interface ShortCandidate {
  symbol: string
  signal_name: string
  grade: string
  win_rate: number
  expected_value: number
  edge_score: number
  current_delivery_pct: number
  delivery_ratio: number
  current_vol_ratio: number
  regime_score: number
  pct_from_sma20: number
  pct_from_sma50: number
  max_drawdown_20d: number
  days_below_sma20: number
  mkt_low_win_rate: number | null
  mkt_low_ev: number | null
  is_active: boolean
  short_score: number
}

export interface SqueezeWatch {
  symbol: string
  trigger_signal: string
  grade: string
  win_rate: number
  expected_value: number
  edge_score: number
  current_delivery_pct: number
  delivery_ratio: number
  current_vol_ratio: number
  regime_score: number
  decline_pct_20d: number
  days_below_sma20: number
  pct_from_sma20: number
  mkt_low_win_rate: number | null
  is_active: boolean
  squeeze_risk: 'High' | 'Medium' | 'Low'
  squeeze_score: number
}

export interface MarketContext {
  avg_regime_score: number
  short_candidate_count: number
  squeeze_watch_count: number
  active_short_signals: number
  active_squeeze_signals: number
  computed_at: string
}

export interface ShortIntelligenceResult {
  short_candidates: ShortCandidate[]
  squeeze_watch: SqueezeWatch[]
  market_context: MarketContext
}

export const GRADE_COLOR: Record<string, string> = {
  'A+': '#22c55e', A: '#86efac', B: '#fbbf24', C: '#94a3b8', D: '#ef4444',
}

export const SQUEEZE_RISK_COLOR: Record<string, string> = {
  High: '#ef4444', Medium: '#f97316', Low: '#fbbf24',
}
