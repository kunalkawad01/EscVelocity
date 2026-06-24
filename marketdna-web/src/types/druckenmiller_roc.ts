export type ROC2Phase =
  | 'strong_uptrend'
  | 'top_inflection'
  | 'early_bottom'
  | 'strong_downtrend'
  | 'neutral'

export interface ROC2HistoryPoint {
  date: string
  close: number
  roc: number | null
  roc2: number | null
  roc_short: number | null
  roc2_short: number | null
  roc_long: number | null
  roc2_long: number | null
  vol_roc2: number | null
  phase: ROC2Phase
}

export interface ROC2StockResult {
  symbol: string
  date: string
  close: number
  roc_short: number | null
  roc_intermediate: number | null
  roc_long: number | null
  roc2_short: number | null
  roc2_intermediate: number | null
  roc2_long: number | null
  vol_roc2: number | null
  phase: ROC2Phase
  lead_count: number
  composite: number
  history: ROC2HistoryPoint[]
  computed_at: string
}

export interface ROC2ScanItem {
  symbol: string
  close: number
  roc_intermediate: number | null
  roc2_intermediate: number | null
  vol_roc2: number | null
  phase: ROC2Phase
  lead_count: number
  composite: number
  sparkline: number[]
}

export interface ROC2ScanResult {
  date: string
  total: number
  early_bottom_count: number
  strong_uptrend_count: number
  top_inflection_count: number
  strong_downtrend_count: number
  stocks: ROC2ScanItem[]
  computed_at: string
}
