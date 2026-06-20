export interface StrikeData {
  strike: number
  ce_oi: number
  pe_oi: number
  ce_oi_change: number | null
  pe_oi_change: number | null
  ce_volume: number
  pe_volume: number
  ce_iv: number | null
  pe_iv: number | null
  ce_ltp: number
  pe_ltp: number
  pcr: number | null
}

export interface MaxPainPoint {
  strike: number
  total_pain: number
}

export interface OIAnalysis {
  symbol: string
  date: string
  expiry: string
  spot: number
  atm_strike: number
  ce_wall: number
  pe_wall: number
  max_pain: number
  pcr: number
  total_ce_oi: number
  total_pe_oi: number
  atm_iv: number | null
  strikes: StrikeData[]
  max_pain_curve: MaxPainPoint[]
  futures_ltp: number | null
  basis_pct: number | null
}

export interface OIBuildupItem {
  symbol: string
  spot: number
  expiry: string
  pcr: number
  max_pain: number | null
  max_pain_distance_pct: number | null
  ce_wall: number
  pe_wall: number
  total_ce_oi: number
  total_pe_oi: number
  ce_wall_oi_change: number | null   // OI change at the CE Wall strike
  pe_wall_oi_change: number | null   // OI change at the PE Wall strike
  signal: string
  signal_color: string
  atm_iv: number | null
  basis_pct: number | null
  futures_ltp: number | null
  futures_chg_pct: number | null
}

export interface OIScannerResponse {
  date: string
  symbols: OIBuildupItem[]
}

export interface EMHistoryRow {
  date: string
  spot: number
  atm_strike: number
  expiry: string
  dte: number
  ce_ltp: number
  pe_ltp: number
  futures_ltp: number | null
  futures_chg_pct: number | null
  straddle_premium: number
  monthly_em: number
  lower_bound: number
  upper_bound: number
  ce_wall: number
  pe_wall: number
  lower_above_pe_wall: boolean
  upper_above_ce_wall: boolean
  ce_direction: string
  pe_direction: string
  futures_direction: string
  signal: string
  signal_color: string
}

export interface EMScanRow {
  symbol: string
  spot: number
  futures_ltp: number | null
  futures_chg_pct: number | null
  straddle_premium: number
  ce_ltp: number
  pe_ltp: number
  monthly_em: number
  lower_bound: number
  upper_bound: number
  ce_wall: number
  pe_wall: number
  lower_above_pe_wall: boolean
  upper_above_ce_wall: boolean
  ce_direction: string
  pe_direction: string
  futures_direction: string
  signal: string
  signal_color: string
  atm_strike: number
  expiry: string
  dte: number
  days_in_series: number
  history: EMHistoryRow[]
}

export interface EMScanResponse {
  date: string
  rows: EMScanRow[]
}

export interface ExpectedMovePoint {
  date: string
  spot: number
  atm_strike: number
  expiry: string
  dte: number
  straddle_premium: number
  ce_ltp: number
  pe_ltp: number
  daily_em: number
  weekly_em: number
  monthly_em: number
  daily_em_pct: number
  weekly_em_pct: number
  monthly_em_pct: number
}

export interface ExpectedMoveHistory {
  symbol: string
  history: ExpectedMovePoint[]
}
