import type { StockIndicators, IndicatorScanResult } from '../types/indicators'
import type { IndicatorEdgeReport, StockEdgeSummaryResult } from '../types/indicatorEdge'

const BASE = '/api/indicators'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export const indicatorsApi = {
  getSymbol:  (symbol: string) => get<StockIndicators>(`${BASE}/${symbol}`),
  scan:       ()               => get<IndicatorScanResult>(`${BASE}/scan`),
  getEdge:        (symbol: string) => get<IndicatorEdgeReport>(`${BASE}/${symbol}/edge`),
  getEdgeSummary: ()               => get<StockEdgeSummaryResult>(`${BASE}/edge/summary`),
  invalidate: ()               => fetch(`${BASE}/invalidate`, { method: 'POST' }).then(r => r.json() as Promise<{ status: string }>),
}
