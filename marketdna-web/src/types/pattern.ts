export interface PatternDetection {
  symbol: string
  pattern: string
  category: string
  confidence: number
  stage: string
  days_forming: number
  breakout_level: number | null
  support_level: number | null
  resistance_level: number | null
  risk_reward: string
  detected_date: string
}

export interface PatternDNAEntry {
  pattern: string
  category: string
  occurrences: number
  success_rate: number
  avg_fwd_21d: number
  avg_fwd_63d: number
  dna_score: number
}

export interface PatternDNAResponse {
  symbol: string
  dna: PatternDNAEntry[]
  best_pattern: string | null
  best_score: number
}

export interface ScannerItem {
  symbol: string
  pattern: string
  category: string
  confidence: number
  stage: string
  days_forming: number
  breakout_level: number | null
}

export interface PatternScannerResponse {
  items: ScannerItem[]
  scanned_at: string
}

export interface ScreenerItem {
  symbol: string
  dna_score: number
  success_rate: number
  avg_fwd_21d: number
  avg_fwd_63d: number
  occurrences: number
  avg_confidence: number
}

export interface PatternScreenerResponse {
  pattern: string
  items: ScreenerItem[]
}

export interface ConfirmedFormingItem {
  symbol: string
  pattern: string
  category: string
  confidence: number
  stage: string
  days_forming: number
  breakout_level: number | null
  support_level: number | null
  risk_reward: string
  dna_score: number
  success_rate: number
  avg_fwd_21d: number
  avg_fwd_63d: number
  occurrences: number
}

export interface ConfirmedFormingResponse {
  items: ConfirmedFormingItem[]
  scanned_at: string
  total_scanned: number
}

// Feature 1: Pattern History Timeline
export interface PatternHistoryItem {
  date: string
  pattern: string
  category: string
  fwd_21d: number | null
  fwd_63d: number | null
  outcome: string // "Win" | "Loss" | "Pending"
}

export interface PatternHistoryResponse {
  symbol: string
  timeframe: string
  items: PatternHistoryItem[]
}

// Feature 2: Breakout Tracker
export interface BreakoutTrackerItem {
  symbol: string
  pattern: string
  category: string
  detected_date: string
  days_since: number
  breakout_level: number | null
  support_level: number | null
  entry_price: number
  current_price: number
  change_pct: number
  status: string // "Confirmed" | "Failed" | "Forming"
}

export interface BreakoutTrackerResponse {
  items: BreakoutTrackerItem[]
  scanned_at: string
  days_back: number
}

// Feature 3: Market Pattern Heatmap
export interface HeatmapCell {
  pattern: string
  category: string
  count: number
  avg_confidence: number
  symbols: string[]
}

export interface PatternHeatmapResponse {
  cells: HeatmapCell[]
  total_symbols: number
  patterns_active: number
  scanned_at: string
}

// Feature 4: Regime-Conditioned DNA
export interface RegimeBucket {
  n: number
  success_rate: number
  avg_ret_21d: number
}

export interface RegimeDNAEntry {
  pattern: string
  category: string
  bull: RegimeBucket
  sideways: RegimeBucket
  bear: RegimeBucket
  best_regime: string
}

export interface RegimeDNAResponse {
  symbol: string
  entries: RegimeDNAEntry[]
}

// Feature 5: Pattern Failure Analysis
export interface PatternFailureItem {
  symbol: string
  failure_rate: number
  occurrences: number
  avg_fwd_21d: number
  avg_loss: number
  dna_score: number
}

export interface PatternFailureResponse {
  pattern: string
  items: PatternFailureItem[]
}
