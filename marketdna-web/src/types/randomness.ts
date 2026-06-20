export interface LuckSkillResult {
  luck_score: number
  luck_label: string
  consistency_score: number
  outcome_dispersion: number
  pct_positive_starts: number
  rolling_cv: number
}

export interface ConcentrationResult {
  total_return_pct: number
  top_1_contribution: number
  top_5_contribution: number
  top_10_contribution: number
  top_20_contribution: number
  rcr: number
  rcr_label: string
  return_actual_pct: number
  return_minus_best_1: number
  return_minus_best_5: number
  return_minus_best_10: number
  return_minus_best_20: number
  concentration_curve: number[]
  top_days: { date: string; return_pct: number }[]
}

export interface FragilityResult {
  fragility_score: number
  fragility_label: string
  worst_period_dependence: number
  dd_recovery_dependence: number
  monte_carlo_p10_cagr: number
  monte_carlo_p50_cagr: number
  monte_carlo_p90_cagr: number
  pct_shuffles_positive: number
  path_iqr: number
  edge_persistence: number
  bull_regime_return: number
  bear_regime_return: number
  regime_dependence_score: number
  mc_histogram: { cagr_pct: number; count: number }[]
}

export interface RandomnessReport {
  symbol: string
  period_start: string
  period_end: string
  years: number
  cagr: number
  luck_skill: LuckSkillResult
  concentration: ConcentrationResult
  fragility: FragilityResult
  verdict: string
  key_risk: string
  computed_at: string
}
