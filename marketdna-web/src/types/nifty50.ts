export interface NiftyIndexTick {
  ltp: number
  prev_close: number
  change: number
  change_pct: number
  ts: string
  source: 'ws' | 'rest'
}

export interface ContributorRow {
  symbol: string
  weight_pct: number
  ltp: number
  change_pct: number
  points_contribution: number
}

export interface ContributorsResponse {
  index: NiftyIndexTick | Record<string, never>
  contributors: ContributorRow[]
  detractors: ContributorRow[]
  n_tracked: number
  n_total: number
}

export interface ConstituentsResponse {
  index: NiftyIndexTick | Record<string, never>
  constituents: ContributorRow[]
  n_tracked: number
  n_total: number
}

// Pushed once a second over /ws/nifty50 -- the index tick plus every tracked
// constituent's tick, so the "all 50 stocks" board updates live off one socket.
export interface NiftyWsMessage {
  index: NiftyIndexTick
  constituents: ContributorRow[]
}

export type NiftyTf =
  | '1min' | '5min' | '15min' | '30min'
  | 'daily' | '2day' | '5day'
  | '1m' | '3m' | '6m' | '1y' | '2y' | '3y' | '5y'

export interface NiftyCandle {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface NiftyHistoryResponse {
  tf: NiftyTf
  symbol: string
  interval?: string
  candles: NiftyCandle[]
  error?: string
}

export type MoversPeriod = 'daily' | 'weekly' | '1m' | '3m' | 'ytd' | '12m'

export interface MoverRow {
  symbol: string
  change_pct: number
}

export interface PeriodMovers {
  gainers: MoverRow[]
  losers: MoverRow[]
}

export interface MoversResponse {
  periods: Record<MoversPeriod, PeriodMovers>
  n_tracked: number
}

export interface AdvDecPoint {
  time: string
  advances: number
  declines: number
  unchanged: number
}

export interface SmaTrendPoint {
  date: string
  pct_above_sma20: number
  pct_above_sma50: number
  pct_above_sma200: number
  is_live?: boolean
}

export interface AdvanceDeclineResponse {
  advances: number
  declines: number
  unchanged: number
  adv_dec_ratio: number | null
  total: number
  n_total: number
  pct_above_sma20: number
  pct_above_sma50: number
  pct_above_sma200: number
  count_above_sma20: number
  count_above_sma50: number
  count_above_sma200: number
  total_symbols: number
  breadth_score: number
  breadth_label: string
  market_open: boolean
  adv_dec_history: { points: AdvDecPoint[] }
  sma_trend: { points: SmaTrendPoint[] }
}

export interface VixState {
  ltp: number
  prev_close: number
  change: number
  change_pct: number
  ts: string
}

export interface PcrPoint {
  time: string
  pcr: number | null
  max_pain: number | null
  spot: number | null
}

export interface PcrHistoryResponse {
  expiry: string
  points: PcrPoint[]
  market_open: boolean
}
