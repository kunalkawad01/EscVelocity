export interface ArchetypeSummary {
  symbol: string
  archetype: string
  conviction: number
  swan: number
  compounding_quality: number
  cagr: number
  max_drawdown: number
  years: number
}

export interface ArchetypeScanResponse {
  items: ArchetypeSummary[]
  ready: boolean
  computed: number
  total: number
}

export interface DrawdownPoint {
  date: string
  drawdown: number
}

export interface CrashResistance {
  covid_2020: number | null
  correction_2022: number | null
  selloff_2024: number | null
}

export interface RegimePerformance {
  bull: number | null
  bear: number | null
  sideways: number | null
  bull_days: number
  bear_days: number
  sideways_days: number
}

export interface AlphaHalfLife {
  m1: number | null
  m3: number | null
  m6: number | null
  m12: number | null
}

export interface CoreReturns {
  cagr: number
  consistency_score: number
  return_concentration: number
  capital_efficiency: number
}

export interface Resilience {
  max_drawdown: number
  drawdown_frequency: number
  avg_recovery_days: number | null
  time_under_water: number
}

export interface TrendQuality {
  trend_efficiency: number
  wealth_smoothness_r2: number
  skill_ratio: number
  cagr_ex_top1: number
  cagr_ex_top5: number
  cagr_ex_top10: number
}

export interface Behavioral {
  pain_to_gain: number
  anti_fragility: number
  opportunity_cost: number
  momentum_persistence_3d: number
  momentum_persistence_5d: number
  momentum_persistence_7d: number
}

export interface CompositeScores {
  conviction: number
  swan: number
  compounding_quality: number
}

export interface StockHealthReport {
  symbol: string
  data_start: string
  data_end: string
  years: number
  archetype: string
  core_returns: CoreReturns
  resilience: Resilience
  trend_quality: TrendQuality
  behavioral: Behavioral
  composite_scores: CompositeScores
  crash_resistance: CrashResistance
  regime_performance: RegimePerformance
  alpha_half_life: AlphaHalfLife
  drawdown_series: DrawdownPoint[]
  computed_at: string
}
