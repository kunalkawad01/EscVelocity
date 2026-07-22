// Types for the F&O Live Tactical Dashboard (/fno-tactical)

export type MarketStateName = 'PRE_PRECOMPUTE' | 'PRE_OPEN' | 'LIVE' | 'CLOSED' | 'HOLIDAY'
export type Quadrant = 'LONG_BUILDUP' | 'SHORT_COVERING' | 'SHORT_BUILDUP' | 'LONG_UNWINDING'
export type Trend = 'UP' | 'DOWN' | 'NONE'
export type Direction = 'long' | 'short' | 'none'
export type Verdict = 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL'

export interface MarketState {
  state: MarketStateName
  session_date: string
  label: string
  is_live: boolean
  server_time: string
}

export interface SignalGrade {
  direction: Direction
  grade: 'A' | 'B' | 'NONE'
  size: 'full' | 'half' | 'none'
  reasons: string[]
}

export interface FnoUniverseRow {
  symbol: string
  sector?: string | null
  ltp: number
  prev_close: number
  open_0915: number
  ret_pct: number
  ret_per_atr: number
  atr_pct?: number | null
  oi?: number | null
  oi_prev_close?: number | null
  oi_chg_pct?: number | null
  quadrant?: Quadrant | null
  trend: Trend
  above_vwap?: boolean | null
  vwap?: number | null
  rel_strength: number
  day_high?: number | null
  day_low?: number | null
  volume?: number | null
  liquid: boolean
  extended: boolean
  grade: SignalGrade
}

export interface FnoUniverseResponse {
  as_of: string
  state: MarketStateName
  session_date: string
  data_mode: string
  oi_live: boolean
  nifty_ret: number
  rows: FnoUniverseRow[]
}

export interface BreadthVerdict {
  as_of: string
  state: MarketStateName
  verdict: Verdict
  pct_above_vwap?: number | null
  adv_decl: number
  advances: number
  declines: number
  nifty_from_0915: number
  longs_enabled: boolean
  shorts_enabled: boolean
  rationale: string
}

export interface NormalizedSeries {
  as_of: string
  state: MarketStateName
  times: string[]
  series: Record<string, number[]>
  note?: string | null
}

export interface OptionLadderRow {
  strike: number
  is_atm: boolean
  ce_ltp?: number | null
  ce_iv?: number | null
  ce_oi: number
  pe_ltp?: number | null
  pe_iv?: number | null
  pe_oi: number
  pcr?: number | null
  oi_total: number
}

export interface OptionChainResponse {
  symbol: string
  is_fo: boolean
  state: MarketStateName
  expiry?: string | null
  spot?: number | null
  atm_strike?: number | null
  straddle?: number | null
  upper_be?: number | null
  lower_be?: number | null
  gamma_wall?: number | null
  total_pcr?: number | null
  lot_size?: number | null
  strikes: OptionLadderRow[]
}

export interface ChartPoint {
  time: string
  value: number
}

export interface StrikeChartResponse {
  symbol: string
  strike: number
  expiry: string
  futures: ChartPoint[]
  futures_oi: ChartPoint[]
  ce: ChartPoint[]
  ce_oi: ChartPoint[]
  pe: ChartPoint[]
  pe_oi: ChartPoint[]
  futures_oi_now: number
  ce_oi_now: number
  pe_oi_now: number
}

// ── AI Desk (chat assistant) ──────────────────────────────────────────────────
export interface FnoToolCall {
  tool: string
  input: Record<string, unknown>
  result_preview: string
}

export interface FnoChatResponse {
  answer: string
  queries: FnoToolCall[]
}
