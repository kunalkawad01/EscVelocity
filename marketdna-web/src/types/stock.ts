export interface Candle {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  sma20: number | null
  sma50: number | null
  sma200: number | null
  daily_return_pct: number | null
}

export interface OHLCVResponse {
  symbol: string
  candles: Candle[]
}

export interface RankPoint {
  date: string
  rank: number
  total: number
  percentile: number
}

export interface RelativeStrengthStats {
  current_rank: number
  best_rank: number
  worst_rank: number
  avg_rank: number
  rank_percentile: number
  total_symbols: number
}

export interface RelativeStrengthResponse {
  symbol: string
  ranks: RankPoint[]
  stats: RelativeStrengthStats
}

export interface ReturnHistogramBin {
  bin_start: number
  bin_end: number
  count: number
}

export interface ReturnStats {
  mean: number
  median: number
  std: number
  p5: number
  p95: number
  max_val: number
  min_val: number
}

export interface MonthlyReturn {
  period: string
  return_pct: number
}

export interface YearlyReturn {
  period: string
  return_pct: number
}

export interface ReturnsResponse {
  symbol: string
  daily_histogram: ReturnHistogramBin[]
  daily_stats: ReturnStats
  monthly_histogram: ReturnHistogramBin[]
  monthly_returns: MonthlyReturn[]
  monthly_stats: ReturnStats
  yearly_returns: YearlyReturn[]
  yearly_stats: ReturnStats
}

export interface ATRPoint {
  date: string
  atr14: number
}

export interface RiskStats {
  current_atr: number
  atr_percentile: number
  atr_trend: 'rising' | 'falling' | 'neutral'
  close: number
  atr_pct_of_price: number
}

export interface RiskResponse {
  symbol: string
  atr_series: ATRPoint[]
  stats: RiskStats
}

export interface DrawdownPoint {
  date: string
  drawdown_pct: number
}

export interface DrawdownStats {
  current_drawdown: number
  max_drawdown: number
  avg_drawdown: number
  days_underwater: number
  total_days: number
  avg_recovery_days: number
}

export interface DrawdownResponse {
  symbol: string
  drawdowns: DrawdownPoint[]
  stats: DrawdownStats
}

export interface RatioPoint {
  date: string
  ratio: number
  sma50: number | null
  sma200: number | null
}

export interface MarketComparisonStats {
  current_ratio: number
  ratio_change_1y: number
  status: 'Outperforming' | 'Underperforming' | 'Neutral'
}

export interface MarketComparisonResponse {
  symbol: string
  ratio_series: RatioPoint[]
  stats: MarketComparisonStats
}

export interface PercentileMetric {
  metric: string
  current_value: number
  unit: string
  percentile: number
  label: string
}

export interface PercentilesResponse {
  symbol: string
  metrics: PercentileMetric[]
}

export interface StockSummary {
  symbol: string
  name: string
  close: number
  change_pct: number
  high_52w: number
  low_52w: number
  avg_volume_20d: number
  above_sma20: boolean
  above_sma50: boolean
  above_sma200: boolean
  regime: 'Bullish' | 'Bearish' | 'Mixed'
  date: string
}

export interface SymbolListResponse {
  symbols: string[]
}

// ── Sprint 2 types ─────────────────────────────────────────────────────────────

export interface RegimePoint {
  date: string
  regime: string
  score: number
}

export interface RegimeStats {
  current_regime: string
  prev_regime: string
  days_in_regime: number
  regime_strength: number
}

export interface RegimeResponse {
  symbol: string
  timeline: RegimePoint[]
  stats: RegimeStats
}

export interface SMAStreak {
  label: string
  current_streak: number
  streak_direction: 'above' | 'below'
  streak_percentile: number
}

export interface TrendPersistenceResponse {
  symbol: string
  streaks: SMAStreak[]
}

export interface Insight {
  title: string
  body: string
  category: 'trend' | 'momentum' | 'risk' | 'strength'
  significance: 'high' | 'medium' | 'low'
}

export interface InsightsResponse {
  symbol: string
  insights: Insight[]
  generated_at: string
}

// ── Z-Score ──────────────────────────────────────────────────────────────────

export interface ZScorePoint { date: string; zscore: number }
export interface ZScoreZoneStats { zone: string; count: number; avg_fwd_21d: number; pct_positive_21d: number }
export interface ZScoreResponse {
  symbol: string
  current_zscore: number
  interpretation: string
  price_mean_252d: number
  price_std_252d: number
  series: ZScorePoint[]
  zone_stats: ZScoreZoneStats[]
}

// ── Dual Momentum ─────────────────────────────────────────────────────────────

export interface DualMomentumHistPoint { date: string; signal: string }
export interface DualMomentumSignalPerf { signal: string; count: number; avg_fwd_21d: number; avg_fwd_63d: number; pct_positive_21d: number }
export interface DualMomentumResponse {
  symbol: string
  current_signal: string
  abs_momentum_12m: number
  rel_momentum_vs_index: number
  index_12m_return: number
  abs_filter_pass: boolean
  rel_filter_pass: boolean
  rationale: string
  history: DualMomentumHistPoint[]
  signal_performance: DualMomentumSignalPerf[]
}

// ── Advanced analytics types ─────────────────────────────────────────────────

export interface ZScorePoint { date: string; zscore: number }
export interface ZScoreData { current_zscore: number; interpretation: string }
export interface HurstData { hurst_exponent: number; regime: string; interpretation: string }
export interface DualMomentumData { abs_momentum_12m: number; rel_momentum_vs_index: number; signal: string; rationale: string }
export interface CVaRData { var_95: number; cvar_95: number; daily_vol: number; interpretation: string }
export interface StatisticalSignalsResponse {
  symbol: string
  zscore: ZScoreData
  zscore_series: ZScorePoint[]
  hurst: HurstData
  dual_momentum: DualMomentumData
  cvar: CVaRData
}

export interface RVPoint { date: string; rv: number }
export interface RealizedVolData { current_rv: number; rv_percentile: number; interpretation: string }
export interface GARCHPoint { date: string; conditional_vol: number }
export interface GARCHData { current_conditional_vol: number; one_day_forecast: number; vol_regime: string }
export interface BetaPoint { date: string; beta: number }
export interface RollingBetaData { current_beta: number; beta_trend: string; interpretation: string }
export interface QuantileRegressionData { q10_expected_return: number; q50_expected_return: number; q90_expected_return: number; tail_asymmetry: string }
export interface VolatilityLabResponse {
  symbol: string
  realized_vol: RealizedVolData
  rv_series: RVPoint[]
  garch: GARCHData
  garch_series: GARCHPoint[]
  rolling_beta: RollingBetaData
  beta_series: BetaPoint[]
  quantile_regression: QuantileRegressionData
}

export interface KMeansData { current_cluster: number; cluster_label: string; cluster_description: string; n_clusters: number; avg_fwd_return: number }
export interface GMMData { current_state: number; state_labels: string[]; state_probabilities: number[] }
export interface HMMPoint { date: string; state: number }
export interface HMMData { current_state: number; state_label: string; state_probability: number; state_labels: string[]; history: HMMPoint[] }
export interface RegimeClustersResponse { symbol: string; kmeans: KMeansData; gmm: GMMData; hmm: HMMData }

export interface KNNData { k: number; predicted_direction: string; confidence: number; avg_fwd_1m: number; avg_fwd_3m: number }
export interface DTWPattern { date: string; dtw_distance: number; pattern_similarity: number; fwd_1m: number | null; fwd_3m: number | null }
export interface PatternMatchResponse {
  symbol: string
  knn: KNNData
  dtw_patterns: DTWPattern[]
  dtw_avg_fwd_1m: number
  dtw_avg_fwd_3m: number
  dtw_pct_positive_1m: number
}

export interface LeadLagPair { other_symbol: string; peak_lag: number; peak_correlation: number; relationship: string }
export interface MarketDynamicsResponse {
  symbol: string
  lead_lag_pairs: LeadLagPair[]
  strongest_leader: string | null
  strongest_lagger: string | null
}

// ── Sprint 3 types ─────────────────────────────────────────────────────────────

export interface AnalogSnapshot {
  regime: string
  regime_score: number
  ret_1m: number
  ret_3m: number | null
  drawdown: number
  atr14: number
}

export interface AnalogPeriod {
  date: string
  similarity: number
  regime: string
  drawdown: number
  ret_1m: number
  fwd_1m: number | null
  fwd_3m: number | null
  fwd_6m: number | null
}

export interface AnalogStats {
  avg_fwd_1m: number
  avg_fwd_3m: number
  avg_fwd_6m: number
  pct_positive_1m: number
  pct_positive_3m: number
}

export interface AnalogResponse {
  symbol: string
  current_snapshot: AnalogSnapshot
  analogs: AnalogPeriod[]
  stats: AnalogStats
}
