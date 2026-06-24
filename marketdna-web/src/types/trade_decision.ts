export type Verdict        = 'STRONG GO' | 'GO' | 'WEAK GO' | 'NO-GO' | 'STRONG NO-GO'
export type Direction      = 'LONG' | 'SHORT'
export type InstrumentType = 'EQUITY' | 'OPTIONS' | 'FUTURES'

export interface MarketContextOut {
  regime_score:  number
  breadth_score: number
  vix_level:     number | null
  posture:       string
  market_score:  number
  key_insight:   string
}

export interface InstrumentAnalysisOut {
  instrument_score: number
  dna_score:        number | null
  regime_score:     number | null
  rs_score:         number | null
  iv_rank:          number | null
  basis_premium:    number | null
  oi_trend:         string | null
  delivery_signal:  string | null
  key_metrics:      Record<string, unknown>
  key_insight:      string
}

export interface SignalConvergenceOut {
  alignment_score:       number
  confirming_signals:    string[]
  contradicting_signals: string[]
  neutral_signals:       string[]
  pattern_active:        string | null
  key_insight:           string
}

export interface RiskCalibrationOut {
  risk_score:        number
  risk_reward_ratio: number | null
  entry_low:         number | null
  entry_high:        number | null
  stop_loss:         number | null
  target_1:          number | null
  target_2:          number | null
  position_size_pct: number | null
  max_risk_pct:      number | null
  atr_20:            number | null
  key_insight:       string
}

export interface HistoricalContextOut {
  historical_score:        number
  win_rate_similar:        number | null
  comparable_setups_count: number
  avg_gain_on_wins:        number | null
  avg_loss_on_losses:      number | null
  regime_win_rate:         number | null
  key_insight:             string
}

export interface TradeBriefResponse {
  symbol:          string
  direction:       Direction
  instrument_type: InstrumentType
  entry_price:     number | null

  market_context:      MarketContextOut
  instrument_analysis: InstrumentAnalysisOut
  signal_convergence:  SignalConvergenceOut
  risk_calibration:    RiskCalibrationOut
  historical_context:  HistoricalContextOut

  confidence:      number
  verdict:         Verdict
  verdict_color:   string
  narrative:       string
  trade_checklist: string[]
}

export interface ScanSetupOut {
  symbol:          string
  direction:       Direction
  instrument_type: InstrumentType
  confidence:      number
  verdict:         Verdict
  verdict_color:   string
  regime_score:    number
  dna_score:       number | null
  rs_score:        number | null
  iv_rank:         number | null
  signal_count:    number
  one_liner:       string
}

export interface ScanResponse {
  setups:        ScanSetupOut[]
  total_scanned: number
  generated_at:  string
}

export interface AnalyzeRequest {
  symbol:          string
  direction:       Direction
  instrument_type: InstrumentType
  entry_price?:    number
  account_size?:   number
}

export interface ScanRequest {
  instrument_types?: InstrumentType[]
  min_confidence?:   number
  max_results?:      number
}
