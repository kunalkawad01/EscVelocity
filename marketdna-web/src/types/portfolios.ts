// src/types/portfolios.ts — Quant Portfolios (OHLCV-only baskets)

export type Universe = 'nifty200' | 'nifty500'

export interface Criterion {
  label: string
  passed: boolean
  value: number | null
}

export interface Holding {
  symbol: string
  name: string | null
  score: number
  weight?: number | null
  reasons: string[]
  checks: Criterion[]
}

export interface PortfolioMeta {
  key: string
  name: string
  description: string
  expected_holding: string
  rebalance: string
  volatility_stars: number
  is_custom?: boolean
}

// ── Custom (user-defined) portfolios ─────────────────────────────────────────
export type WeightScheme = 'equal' | 'score' | 'inverse_vol' | 'by_field'
export type EvictionWeight = 'redistribute' | 'hold_cash'
export type RebalanceFreq = 'W' | 'M' | 'Q'

export interface WeightSpec {
  scheme: WeightScheme
  field?: string | null
}

export interface PortfolioSpec {
  key: string
  name: string
  description?: string
  universe?: Universe
  expected_holding?: string
  volatility_stars?: number
  max_holdings?: number
  entry: string
  rank_by?: string
  weight?: WeightSpec
  fill?: string | null
  fill_rank_by?: string | null
  eviction?: string | null
  eviction_weight?: EvictionWeight
  rebalance_freq?: RebalanceFreq
  rebalance?: string | null
  rebalance_weight?: WeightSpec
  created_at?: string | null
  is_custom?: boolean
}

export interface FieldInfo {
  name: string
  label: string
  kind: 'numeric' | 'boolean'
  unit: string | null
  group: string | null
  position_only: boolean
}

export interface FieldCatalogResponse {
  fields: FieldInfo[]
  operators: string[]
}

export interface NLDraftResponse {
  spec: PortfolioSpec          // generated draft (not yet saved) — fills the builder form
  summary: string              // plain-English readback of what the rules do
  warnings: string[]           // e.g. no eviction rule, empty-screen risk
  preview_count: number        // how many stocks the entry rule matches right now
  preview_symbols: string[]    // first few current matches
  attempts: number             // LLM passes incl. auto-repairs
}

export interface PortfolioListResponse {
  portfolios: PortfolioMeta[]
}

export interface ScreenResponse extends PortfolioMeta {
  universe: Universe
  as_of: string
  count: number
  holdings: Holding[]
}

export interface LiveHolding {
  symbol: string
  name: string | null
  ltp: number | null
  return_pct: number | null
}

export interface LiveResponse {
  key: string
  name: string
  universe: Universe
  state: string
  state_label: string
  is_live: boolean
  source: 'live' | 'eod'
  server_time: string | null
  as_of: string
  count: number
  basket_return_pct: number | null
  advancers: number
  decliners: number
  holdings: LiveHolding[]
}

export interface NavPoint {
  date: string
  nav: number
}

export interface RebalEvent {
  date: string
  action: string           // INCEPTION | ADD | DROP
  symbol: string
  rationale: string | null
}

export interface TrackHolding {
  symbol: string
  name: string | null
  weight_pct: number
  entry_close: number
  ltp: number | null
  since_entry_pct: number | null
  rationale: string | null
  ret_1d: number | null;  ret_1d_rank: number | null
  ret_5d: number | null;  ret_5d_rank: number | null
  ret_1m: number | null;  ret_1m_rank: number | null
  ret_3m: number | null;  ret_3m_rank: number | null
  ret_6m: number | null;  ret_6m_rank: number | null
  ret_1y: number | null;  ret_1y_rank: number | null
}

export interface TrackResponse {
  key: string
  name: string
  description: string
  universe: Universe
  rebalance: string
  expected_holding: string
  volatility_stars: number
  inception_date: string
  as_of: string
  is_live: boolean
  source: 'live' | 'eod'
  current_nav: number
  total_return_pct: number
  days_live: number
  count: number
  equity_curve: NavPoint[]
  holdings: TrackHolding[]
  rebalance_log: RebalEvent[]
}

export interface BacktestResponse {
  key: string
  name: string
  freq: string
  universe: Universe
  periods: number
  years: number
  total_return_pct: number
  cagr_pct: number
  vol_pct: number
  sharpe: number | null
  sortino: number | null
  max_drawdown_pct: number
  hit_rate_pct: number
  alpha_pct: number | null
  best_period_pct: number
  worst_period_pct: number
  final_growth_of_100: number
  bench_growth_of_100: number
  equity_curve: Record<string, number>
  bench_curve: Record<string, number>
  monthly_returns: Record<string, number>
}
