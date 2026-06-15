export interface MomentumItem {
  symbol: string
  sector: string
  ret_12_1m: number
  ret_3m: number
  ret_1m: number
  rank: number
  quintile: number        // 1=top, 5=bottom
  signal: string
  options_strategy: string
}

export interface MomentumResult {
  items: MomentumItem[]
  top_5: string[]
  bottom_5: string[]
  as_of: string
}

export interface MeanReversionItem {
  symbol: string
  sector: string
  z_score_20d: number
  z_score_50d: number
  bb_pct_b: number
  rsi: number
  reversion_score: number   // positive = overbought
  signal: string
  options_strategy: string
}

export interface MeanReversionResult {
  items: MeanReversionItem[]
  overbought: string[]
  oversold: string[]
  as_of: string
}

export interface VolRankItem {
  symbol: string
  sector: string
  hv20: number
  hv20_1m_ago: number
  hv_rank: number
  vol_trend: string
  regime: string
  options_strategy: string
  iv_action: string
}

export interface VolRankResult {
  items: VolRankItem[]
  sell_candidates: string[]
  buy_candidates: string[]
  as_of: string
}

export interface SectorItem {
  sector: string
  symbols: string[]
  n_stocks: number
  ret_1m: number
  ret_3m: number
  rs_1m: number
  rs_3m: number
  rank_3m: number
  phase: string   // "Leading" | "Weakening" | "Lagging" | "Improving"
}

export interface SectorRotationResult {
  sectors: SectorItem[]
  nifty_ret_1m: number
  nifty_ret_3m: number
  leading: string[]
  improving: string[]
  weakening: string[]
  lagging: string[]
  as_of: string
}

export interface QuantScanResult {
  momentum: MomentumResult
  mean_reversion: MeanReversionResult
  vol_rank: VolRankResult
  sector_rotation: SectorRotationResult
  computed_at: string
}

// Display helpers
export const QUINTILE_COLOR: Record<number, string> = {
  1: '#22c55e',
  2: '#86efac',
  3: '#94a3b8',
  4: '#f87171',
  5: '#ef4444',
}

export const SIGNAL_COLOR: Record<string, string> = {
  'Strong Long':  '#22c55e',
  'Long':         '#86efac',
  'Neutral':      '#94a3b8',
  'Avoid':        '#f87171',
  'Strong Avoid': '#ef4444',
  'Overbought':   '#ef4444',
  'Near OB':      '#f87171',
  'Near OS':      '#86efac',
  'Oversold':     '#22c55e',
}

export const PHASE_COLOR: Record<string, string> = {
  'Leading':   '#22c55e',
  'Improving': '#86efac',
  'Weakening': '#f59e0b',
  'Lagging':   '#ef4444',
}

export const VOL_REGIME_COLOR: Record<string, string> = {
  'Very High': '#ef4444',
  'Elevated':  '#f87171',
  'Normal':    '#94a3b8',
  'Low':       '#86efac',
  'Very Low':  '#22c55e',
}
