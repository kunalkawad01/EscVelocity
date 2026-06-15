export interface SpreadSignalStats {
  occurrences: number
  avg_1w: number
  avg_1m: number
  win_rate: number
  expected_value: number
  max_adverse: number
  distribution: Record<string, number>
  mkt_regime_high_win_rate: number | null
  mkt_regime_low_win_rate: number | null
  mkt_regime_high_ev: number | null
  mkt_regime_low_ev: number | null
  mkt_regime_high_occurrences: number
  mkt_regime_low_occurrences: number
}

export interface PairResult {
  symbol_y: string
  symbol_x: string
  p_value: number
  hedge_ratio: number
  half_life: number
  correlation: number
  spread_mean: number
  spread_std: number
  current_zscore: number
  grade: string
  long_stats:  SpreadSignalStats | null
  short_stats: SpreadSignalStats | null
  zscore_history: number[]
  dates: string[]
  computed_at: string
}

export interface CointegrationScanResult {
  pairs: PairResult[]
  total_pairs_universe: number
  total_correlation_passed: number
  total_cointegrated: number
  correlation_threshold: number
  pvalue_threshold: number
  computed_at: string
}

export const GRADE_COLOR: Record<string, string> = {
  'A+': '#22c55e',
  'A':  '#86efac',
  'B':  '#fbbf24',
  'C':  '#94a3b8',
}

export const GRADE_BG: Record<string, string> = {
  'A+': 'rgba(34,197,94,0.12)',
  'A':  'rgba(134,239,172,0.10)',
  'B':  'rgba(251,191,36,0.10)',
  'C':  'rgba(148,163,184,0.08)',
}
