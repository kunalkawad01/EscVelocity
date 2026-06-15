import type {
  OHLCVResponse, RelativeStrengthResponse, ReturnsResponse,
  RiskResponse, DrawdownResponse, MarketComparisonResponse,
  PercentilesResponse, StockSummary, SymbolListResponse,
  RegimeResponse, TrendPersistenceResponse, InsightsResponse,
  AnalogResponse,
  ZScoreResponse, DualMomentumResponse,
  StatisticalSignalsResponse, VolatilityLabResponse,
  RegimeClustersResponse, PatternMatchResponse, MarketDynamicsResponse,
} from '../types/stock'

const BASE = '/api/stock'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function post<T>(url: string, body: object): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export interface ChatResponse {
  answer: string
  queries: Array<{ label: string; sql: string }>
}

export const stockApi = {
  getSymbols: () => get<SymbolListResponse>(`${BASE}/symbols`),
  getSummary: (symbol: string) => get<StockSummary>(`${BASE}/${symbol}/summary`),
  getOHLCV: (symbol: string) => get<OHLCVResponse>(`${BASE}/${symbol}/ohlcv`),
  getRelativeStrength: (symbol: string) => get<RelativeStrengthResponse>(`${BASE}/${symbol}/relative-strength`),
  getReturns: (symbol: string) => get<ReturnsResponse>(`${BASE}/${symbol}/returns`),
  getRisk: (symbol: string) => get<RiskResponse>(`${BASE}/${symbol}/risk`),
  getDrawdown: (symbol: string) => get<DrawdownResponse>(`${BASE}/${symbol}/drawdown`),
  getMarketComparison: (symbol: string) => get<MarketComparisonResponse>(`${BASE}/${symbol}/market-comparison`),
  getPercentiles: (symbol: string) => get<PercentilesResponse>(`${BASE}/${symbol}/percentiles`),
  askQuestion: (symbol: string, question: string) =>
    post<ChatResponse>(`${BASE}/${symbol}/chat`, { question }),
  getRegime: (symbol: string) => get<RegimeResponse>(`${BASE}/${symbol}/regime`),
  getTrendPersistence: (symbol: string) => get<TrendPersistenceResponse>(`${BASE}/${symbol}/trend-persistence`),
  getInsights: (symbol: string) => get<InsightsResponse>(`${BASE}/${symbol}/insights`),
  getAnalogs: (symbol: string) => get<AnalogResponse>(`${BASE}/${symbol}/analogs`),
  getZScore: (symbol: string) => get<ZScoreResponse>(`${BASE}/${symbol}/zscore`),
  getDualMomentum: (symbol: string) => get<DualMomentumResponse>(`${BASE}/${symbol}/dual-momentum`),
  getStatisticalSignals: (symbol: string) => get<StatisticalSignalsResponse>(`${BASE}/${symbol}/statistical-signals`),
  getVolatilityLab: (symbol: string) => get<VolatilityLabResponse>(`${BASE}/${symbol}/volatility-lab`),
  getRegimeClusters: (symbol: string) => get<RegimeClustersResponse>(`${BASE}/${symbol}/regime-clusters`),
  getPatternMatch: (symbol: string) => get<PatternMatchResponse>(`${BASE}/${symbol}/pattern-match`),
  getMarketDynamics: (symbol: string) => get<MarketDynamicsResponse>(`${BASE}/${symbol}/market-dynamics`),
}
