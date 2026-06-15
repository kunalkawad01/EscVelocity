import type {
  PatternDetection, PatternDNAResponse,
  PatternScannerResponse, PatternScreenerResponse,
  ConfirmedFormingResponse,
  PatternHistoryResponse,
  BreakoutTrackerResponse,
  PatternHeatmapResponse,
  RegimeDNAResponse,
  PatternFailureResponse,
} from '../types/pattern'
import type { ValidationReport } from '../types/validation'

const BASE = '/api/patterns'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export const patternApi = {
  getScanner:          (timeframe = 'daily') => get<PatternScannerResponse>(`${BASE}/scanner?timeframe=${timeframe}`),
  getScreener:         (pattern: string) => get<PatternScreenerResponse>(`${BASE}/screener/${encodeURIComponent(pattern.replace(/ /g, '-').toLowerCase())}`),
  getConfirmedForming: (timeframe = 'daily') => get<ConfirmedFormingResponse>(`${BASE}/confirmed-forming?timeframe=${timeframe}`),
  getValidation:       ()               => get<ValidationReport>(`${BASE}/validation`),
  getDNA:              (symbol: string)  => get<PatternDNAResponse>(`${BASE}/${symbol}/dna`),
  getDetect:           (symbol: string, timeframe = 'daily') => get<PatternDetection[]>(`${BASE}/${symbol}/detect?timeframe=${timeframe}`),
  // Feature 1: Pattern History Timeline
  getHistory:          (symbol: string, timeframe = 'daily') => get<PatternHistoryResponse>(`${BASE}/${symbol}/history?timeframe=${timeframe}`),
  // Feature 2: Breakout Tracker
  getBreakoutTracker:  (daysBack = 60) => get<BreakoutTrackerResponse>(`${BASE}/breakout-tracker?days_back=${daysBack}`),
  // Feature 3: Market Pattern Heatmap
  getHeatmap:          (timeframe = 'daily') => get<PatternHeatmapResponse>(`${BASE}/heatmap?timeframe=${timeframe}`),
  // Feature 4: Regime-Conditioned DNA
  getRegimeDNA:        (symbol: string) => get<RegimeDNAResponse>(`${BASE}/${symbol}/regime-dna`),
  // Feature 5: Pattern Failure Analysis
  getFailures:         (pattern: string) => get<PatternFailureResponse>(`${BASE}/failures/${encodeURIComponent(pattern.replace(/ /g, '-').toLowerCase())}`),
}
