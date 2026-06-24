import type {
  SectorScatterResponse,
  SectorDrillDownResponse,
  StockIntelligenceResponse,
  BreakthroughSignalsResponse,
  StockChartResponse,
  SectorProgressionsResponse,
} from '../types/live'
import type { IntradayReturnsResponse, NormHistoryResponse } from '../types/intraday_race'

const BASE = '/api/live'
const INTRADAY_BASE = '/api/intraday'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export type Universe = 'nifty500' | 'nifty200'

export const liveApi = {
  getSectors: (universe: Universe = 'nifty500') =>
    get<SectorScatterResponse>(`${BASE}/sectors?universe=${universe}`),
  getSectorDetail: (sector: string, universe: Universe = 'nifty500') =>
    get<SectorDrillDownResponse>(`${BASE}/sector/${encodeURIComponent(sector)}?universe=${universe}`),
  getStockIntelligence: (symbol: string) =>
    get<StockIntelligenceResponse>(`${BASE}/stock/${symbol}`),
  getSignals: (universe: Universe = 'nifty500') =>
    get<BreakthroughSignalsResponse>(`${BASE}/signals?universe=${universe}`),
  getStockChart: (symbol: string) =>
    get<StockChartResponse>(`${BASE}/stock/${symbol}/chart`),
  getSectorProgressions: (universe: Universe = 'nifty500') =>
    get<SectorProgressionsResponse>(`${BASE}/sector-progressions?universe=${universe}`),
}

export const intradayApi = {
  getReturns: () =>
    get<IntradayReturnsResponse>(`${INTRADAY_BASE}/returns`),
  getNormHistory: () =>
    get<NormHistoryResponse>(`${INTRADAY_BASE}/norm-history`),
  getSnapshot: (time: string) =>
    get<IntradayReturnsResponse>(`${INTRADAY_BASE}/snapshot?time=${encodeURIComponent(time)}`),
}
