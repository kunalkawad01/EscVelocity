export const REGIMES = [
  'Strong Uptrend',
  'Volatile Bull',
  'Sideways Quiet',
  'Sideways Volatile',
  'Steady Bear',
  'Volatile Bear',
] as const

export type Regime = typeof REGIMES[number]

export const REGIME_COLOR: Record<Regime, string> = {
  'Strong Uptrend':   '#22c55e',
  'Volatile Bull':    '#86efac',
  'Sideways Quiet':   '#94a3b8',
  'Sideways Volatile':'#f59e0b',
  'Steady Bear':      '#ef4444',
  'Volatile Bear':    '#7f1d1d',
}

export const REGIME_BG: Record<Regime, string> = {
  'Strong Uptrend':   'rgba(34,197,94,0.12)',
  'Volatile Bull':    'rgba(134,239,172,0.10)',
  'Sideways Quiet':   'rgba(148,163,184,0.10)',
  'Sideways Volatile':'rgba(245,158,11,0.12)',
  'Steady Bear':      'rgba(239,68,68,0.12)',
  'Volatile Bear':    'rgba(127,29,29,0.20)',
}

export interface RegimeMonth {
  month: string
  regime: Regime
  adx: number
  rsi: number
  pct_vs_sma50: number
  monthly_ret: number
  hv_ratio: number
}

export interface TransitionMatrix {
  regimes: string[]
  matrix: number[][]
  counts: number[][]
}

export interface OptionsStrategy {
  primary: string
  alternatives: string[]
  avoid: string[]
  rationale: string
  iv_action: 'Buy' | 'Sell'
}

export interface RegimeForecast {
  current_regime: Regime
  probabilities: Record<Regime, number>
  dominant_regime: Regime
  dominant_probability: number
  tail_risk_regime: Regime | null
  tail_risk_probability: number | null
  strategy: OptionsStrategy
}

export interface MarkovOptionsResult {
  symbol: string
  history: RegimeMonth[]
  matrix: TransitionMatrix
  forecast: RegimeForecast
  n_months: number
  computed_at: string
}

export interface MarketRegimeItem {
  symbol: string
  current_regime: Regime
  dominant_next: Regime
  dominant_prob: number
  primary_strategy: string
  iv_action: 'Buy' | 'Sell'
}

export interface MarketMarkovResult {
  items: MarketRegimeItem[]
  regime_distribution: Record<Regime, number>
  dominant_market_regime: Regime
  scanned_at: string
}
