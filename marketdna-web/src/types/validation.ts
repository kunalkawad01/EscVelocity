export interface OOSSplitResult {
  pattern: string
  n_symbols: number
  is_n: number
  oos_n: number
  is_success_rate: number
  oos_success_rate: number
  is_avg_ret_21d: number
  oos_avg_ret_21d: number
  degradation_pct: number
  passes: boolean
}

export interface DecileRow {
  rank: string
  n_symbols: number
  avg_dna_score: number
  oos_avg_ret_21d: number
  n_detections: number
}

export interface DecileResult {
  pattern: string
  rows: DecileRow[]
  spread_pct: number
  monotonic: boolean
  passes: boolean
}

export interface ConfBin {
  label: string
  n: number
  success_rate: number
  avg_ret_21d: number
}

export interface CalibrationResult {
  pattern: string
  bins: ConfBin[]
  monotonic: boolean
  passes: boolean
}

export interface ValidationSummary {
  pattern: string
  step2_oos: boolean | null
  step3_decile: boolean | null
  step4_calibration: boolean | null
  verdict: 'VALIDATED' | 'PARTIAL' | 'UNVALIDATED' | 'INSUFFICIENT_DATA'
}

export interface ValidationReport {
  generated_at: string
  is_bars: number
  oos_bars: number
  min_occurrences: number
  n_symbols_total: number
  n_symbols_sufficient: number
  oos_results: OOSSplitResult[]
  decile_results: DecileResult[]
  calibration_results: CalibrationResult[]
  summary: ValidationSummary[]
}
