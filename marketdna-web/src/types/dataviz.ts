export interface ReturnBar {
  symbol: string
  value: number
}

export interface ReturnSnapshotStats {
  n_symbols: number
  n_positive: number
  n_negative: number
  avg: number
  median: number
  max_val: number
  min_val: number
}

export interface ReturnSnapshotResponse {
  horizon: string
  as_of: string
  winners: ReturnBar[]
  losers: ReturnBar[]
  stats: ReturnSnapshotStats
  computed_at: string
}

export interface ReturnHistoryPoint {
  date: string
  value: number
}

export interface ReturnHistoryResponse {
  symbol: string
  metric: string
  data: ReturnHistoryPoint[]
}

export interface ScatterPoint {
  symbol: string
  ret: number
  std: number
}

export interface ScatterStats {
  n_symbols: number
  median_ret: number
  median_std: number
  n_high_ret_low_vol: number
  n_high_ret_high_vol: number
  n_low_ret_low_vol: number
  n_low_ret_high_vol: number
}

export interface ScatterResponse {
  horizon: string
  ret_col: string
  std_col: string
  as_of: string
  points: ScatterPoint[]
  stats: ScatterStats
  computed_at: string
}

export interface Above200WeeklyPoint {
  week_date: string
  n_above_200: number
  total_symbols: number
  pct_above_200: number
}

export interface Above200WeeklyResponse {
  as_of: string
  n_symbols: number
  data: Above200WeeklyPoint[]
  computed_at: string
}

export interface HistogramBucket { center: number; count: number }
export interface HistogramStats { mean: number; median: number; std: number; skew: number; min_val: number; max_val: number }
export interface HistogramResponse { horizon: string; as_of: string; buckets: HistogramBucket[]; stats: HistogramStats; computed_at: string }

export interface VolTermPoint { label: string; days: number; std_pct: number }
export interface VolTermStructureResponse { symbol: string; as_of: string; points: VolTermPoint[]; computed_at: string }

export interface CrossVolPoint { week_date: string; cross_vol_pct: number; cross_mean_pct: number }
export interface CrossVolResponse { as_of: string; data: CrossVolPoint[]; computed_at: string }

export interface RiskAdjPoint { rank: number; symbol: string; ret: number; std: number; score: number }
export interface RiskAdjResponse { horizon: string; as_of: string; data: RiskAdjPoint[]; computed_at: string }

export interface CalendarPoint { date: string; ret_pct: number }
export interface CalendarResponse { symbol: string; year: number; data: CalendarPoint[]; computed_at: string }

export interface MultiSMAPoint { week_date: string; total_symbols: number; pct_above_20: number; pct_above_50: number; pct_above_200: number }
export interface MultiSMAResponse { as_of: string; data: MultiSMAPoint[]; computed_at: string }

export interface ADPoint { week_date: string; advancers: number; decliners: number; net: number; cumulative: number }
export interface ADResponse { as_of: string; data: ADPoint[]; computed_at: string }

export interface CorrMatrixResponse { as_of: string; symbols: string[]; matrix: number[][]; computed_at: string }

export interface AlphaBetaPoint { symbol: string; alpha: number; beta: number; r_squared: number }
export interface AlphaBetaResponse { as_of: string; horizon: string; lookback: number; points: AlphaBetaPoint[]; computed_at: string }
