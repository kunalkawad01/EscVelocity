export interface RegimeComponents {
  price_score: number      // 0–40
  alignment_score: number  // 0–30
  slope_score: number      // 0–30
}

export interface SMASummary {
  sma20: number
  sma50: number
  sma100: number
  sma200: number
  above_sma20: boolean
  above_sma50: boolean
  above_sma100: boolean
  above_sma200: boolean
}

export interface SlopeInfo {
  sma20_slope: number
  sma50_slope: number
  sma200_slope: number
  sma20_rising: boolean
  sma50_rising: boolean
  sma200_rising: boolean
}

export interface RegimeHistoryPoint {
  date: string
  close: number
  regime_score: number
}

export interface RegimeScoreResult {
  symbol: string
  date: string
  close: number
  regime_score: number
  regime_label: string
  components: RegimeComponents
  sma: SMASummary
  slope: SlopeInfo
  sma_fully_aligned: boolean
  history: RegimeHistoryPoint[]
  computed_at: string
}

export interface BreadthHistoryPoint {
  date: string
  breadth_score: number
  pct_above_sma20: number
  pct_above_sma50: number
  pct_above_sma200: number
}

export interface BreadthScoreResult {
  date: string
  pct_above_sma20: number
  pct_above_sma50: number
  pct_above_sma200: number
  count_above_sma20: number
  count_above_sma50: number
  count_above_sma200: number
  total_symbols: number
  breadth_score: number
  breadth_label: string
  history: BreadthHistoryPoint[]
  computed_at: string
}

export interface StockRegimeSummary {
  symbol: string
  regime_score: number
  regime_label: string
  close: number
  above_sma200: boolean
  sma_fully_aligned: boolean
  price_score: number
  alignment_score: number
  slope_score: number
}

export interface MarketRegimeSnapshot {
  date: string
  breadth: BreadthScoreResult
  stocks: StockRegimeSummary[]
  avg_regime_score: number
  strong_bull_count: number
  bull_count: number
  neutral_count: number
  bear_count: number
  strong_bear_count: number
  computed_at: string
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export const REGIME_COLOR: Record<string, string> = {
  'Strong Bull':   '#22c55e',
  'Moderate Bull': '#86efac',
  'Neutral':       '#fbbf24',
  'Moderate Bear': '#f87171',
  'Strong Bear':   '#ef4444',
}

export const REGIME_BG: Record<string, string> = {
  'Strong Bull':   'rgba(34,197,94,0.08)',
  'Moderate Bull': 'rgba(134,239,172,0.08)',
  'Neutral':       'rgba(251,191,36,0.08)',
  'Moderate Bear': 'rgba(248,113,113,0.08)',
  'Strong Bear':   'rgba(239,68,68,0.08)',
}

export function regimeColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 60) return '#86efac'
  if (score >= 40) return '#fbbf24'
  if (score >= 20) return '#f87171'
  return '#ef4444'
}
