import type {
  SectorScatterResponse,
  SectorDrillDownResponse,
  StockIntelligenceResponse,
  BreakthroughSignalsResponse,
  StockChartResponse,
  SectorProgressionsResponse,
} from '../types/live'

const BASE = '/api/live'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export const liveApi = {
  getSectors: () => get<SectorScatterResponse>(`${BASE}/sectors`),
  getSectorDetail: (sector: string) => get<SectorDrillDownResponse>(`${BASE}/sector/${encodeURIComponent(sector)}`),
  getStockIntelligence: (symbol: string) => get<StockIntelligenceResponse>(`${BASE}/stock/${symbol}`),
  getSignals: () => get<BreakthroughSignalsResponse>(`${BASE}/signals`),
  getStockChart: (symbol: string) => get<StockChartResponse>(`${BASE}/stock/${symbol}/chart`),
  getSectorProgressions: () => get<SectorProgressionsResponse>(`${BASE}/sector-progressions`),
}
