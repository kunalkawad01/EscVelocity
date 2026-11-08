// Result Reaction (/result-reaction) — response shapes for /api/result-reaction

export interface QuarterReaction {
  result_date: string
  reaction_date: string
  day_minus1_pct: number | null
  day0_pct: number | null
  day_plus1_pct: number | null
}

export interface SymbolResultReaction {
  symbol: string
  quarters: QuarterReaction[]
  avg_day_minus1_pct: number | null
  avg_day0_pct: number | null
  avg_day_plus1_pct: number | null
  win_rate: number | null
  n_quarters: number
  error?: string | null
}

export interface ResultReactionScanResponse {
  items: SymbolResultReaction[]
  ready: boolean
  computed: number
  total: number
}
