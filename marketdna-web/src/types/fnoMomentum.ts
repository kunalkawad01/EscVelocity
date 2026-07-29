// F&O Momentum Radar (/fno-momentum) — response shapes for /api/fno-momentum

export type MomentumCriterion = 'BIG_MOVE_PREV' | 'TOP_SECTOR' | 'GAP_0915'

export interface SectorPerf {
  sector: string
  avg_ret: number
  count: number
}

export interface MomentumRow {
  symbol: string
  sector?: string
  ltp: number
  prev_close: number
  change_pct: number
  last_session_ret?: number
  gap_0915_pct?: number
  oi?: number
  oi_chg_pct?: number
  quadrant?: string
  volume?: number
  open_0915?: number
  day_high?: number
  day_low?: number
  criteria: MomentumCriterion[]
}

export interface MomentumThresholds {
  big_move_pct: number
  gap_pct: number
  top_sectors_n: number
  live_move_pct: number
}

export interface FnoMomentumResponse {
  as_of: string
  state: 'PRE_PRECOMPUTE' | 'PRE_OPEN' | 'LIVE' | 'CLOSED' | 'HOLIDAY'
  session_date: string
  data_mode: 'live' | 'eod_fallback'
  oi_live: boolean
  thresholds: MomentumThresholds
  top_sectors: SectorPerf[]
  oi_gainers: MomentumRow[]
  short_covering: MomentumRow[]
  open_eq_high: MomentumRow[]
  open_eq_low: MomentumRow[]
  movers_up: MomentumRow[]
  movers_down: MomentumRow[]
}
