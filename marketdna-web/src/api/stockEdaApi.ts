import type {
  VolatilitySeriesResponse, DrawdownHistoryResponse, SeasonalityResponse,
  GapsResponse, VolumeProfileResponse, AutocorrelationResponse,
  ExtremeDaysResponse, BenchmarkComparisonResponse,
} from '../types/stockEda'

const BASE = '/api/stock-eda'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export const stockEdaApi = {
  getVolatilitySeries: (symbol: string) => get<VolatilitySeriesResponse>(`${BASE}/${symbol}/volatility-series`),
  getDrawdownHistory: (symbol: string) => get<DrawdownHistoryResponse>(`${BASE}/${symbol}/drawdown-history`),
  getSeasonality: (symbol: string) => get<SeasonalityResponse>(`${BASE}/${symbol}/seasonality`),
  getGaps: (symbol: string) => get<GapsResponse>(`${BASE}/${symbol}/gaps`),
  getVolumeProfile: (symbol: string, bars = 252) => get<VolumeProfileResponse>(`${BASE}/${symbol}/volume-profile?bars=${bars}`),
  getAutocorrelation: (symbol: string) => get<AutocorrelationResponse>(`${BASE}/${symbol}/autocorrelation`),
  getExtremeDays: (symbol: string) => get<ExtremeDaysResponse>(`${BASE}/${symbol}/extreme-days`),
  getBenchmarkComparison: (symbol: string) => get<BenchmarkComparisonResponse>(`${BASE}/${symbol}/benchmark-comparison`),
  invalidate: async (symbol: string): Promise<void> => {
    await fetch(`${BASE}/${symbol}/invalidate`, { method: 'POST' })
  },
}
