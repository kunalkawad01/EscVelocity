export interface VolatilityPoint {
  date: string
  realized_vol_20d: number
  vol_of_vol_20d: number
}
export interface VolatilitySeriesResponse {
  symbol: string
  series: VolatilityPoint[]
  current_vol: number
  vol_percentile: number
}

export interface DrawdownEpisode {
  start_date: string
  trough_date: string
  recovery_date: string | null
  depth_pct: number
  duration_days: number
  recovery_days: number | null
}
export interface DrawdownHistoryResponse {
  symbol: string
  episodes: DrawdownEpisode[]
}

export interface SeasonalityCell {
  month: number
  day_of_week: number
  avg_return_pct: number
  n: number
}
export interface SeasonalityResponse {
  symbol: string
  grid: SeasonalityCell[]
  best_month: number
  worst_month: number
}

export interface GapPoint {
  date: string
  gap_pct: number
  filled: boolean
}
export interface GapBucket {
  label: string
  count: number
  fill_rate_pct: number
}
export interface GapsResponse {
  symbol: string
  points: GapPoint[]
  buckets: GapBucket[]
  overall_fill_rate_pct: number
}

export interface VolumeProfileBin {
  price_low: number
  price_high: number
  volume: number
}
export interface VolumeProfileResponse {
  symbol: string
  bins: VolumeProfileBin[]
  point_of_control: number
  lookback_bars: number
}

export interface ACFPoint {
  lag: number
  value: number
}
export interface AutocorrelationResponse {
  symbol: string
  acf: ACFPoint[]
  significance_band: number
}

export interface ExtremeDay {
  date: string
  return_pct: number
  volume_ratio: number
}
export interface ExtremeDaysResponse {
  symbol: string
  best: ExtremeDay[]
  worst: ExtremeDay[]
}

export interface BenchmarkDayComparison {
  date: string
  stock_return_pct: number
  sector_return_pct: number
  nifty50_return_pct: number
  nifty200_return_pct: number
  nifty500_return_pct: number
}
export interface BenchmarkComparisonResponse {
  symbol: string
  sector_name: string | null
  days: BenchmarkDayComparison[]
}
