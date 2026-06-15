import type {
  ReturnSnapshotResponse, ReturnHistoryResponse, ScatterResponse, Above200WeeklyResponse,
  HistogramResponse, VolTermStructureResponse, CrossVolResponse, RiskAdjResponse,
  CalendarResponse, MultiSMAResponse, ADResponse, CorrMatrixResponse, AlphaBetaResponse,
} from '../types/dataviz'

const BASE = '/api/dataviz'

export const datavizApi = {
  async getSnapshot(horizon = 'ret_1d', top_n = 30): Promise<ReturnSnapshotResponse> {
    const r = await fetch(`${BASE}/returns/snapshot?horizon=${horizon}&top_n=${top_n}`)
    if (!r.ok) throw new Error(`API error ${r.status}`)
    return r.json()
  },

  async getHistory(symbol: string, metric = 'ret_1d'): Promise<ReturnHistoryResponse> {
    const r = await fetch(`${BASE}/returns/history/${symbol}?metric=${metric}`)
    if (!r.ok) throw new Error(`API error ${r.status}`)
    return r.json()
  },

  async getScatter(horizon = '1m'): Promise<ScatterResponse> {
    const r = await fetch(`${BASE}/scatter?horizon=${horizon}`)
    if (!r.ok) throw new Error(`API error ${r.status}`)
    return r.json()
  },

  async getAbove200Weekly(): Promise<Above200WeeklyResponse> {
    const r = await fetch(`${BASE}/breadth/above200-weekly`)
    if (!r.ok) throw new Error(`API error ${r.status}`)
    return r.json()
  },

  async getHistogram(horizon = 'ret_1d'): Promise<HistogramResponse> {
    const r = await fetch(`${BASE}/histogram?horizon=${horizon}`)
    if (!r.ok) throw new Error(`API error ${r.status}`)
    return r.json()
  },

  async getVolTermStructure(symbol: string): Promise<VolTermStructureResponse> {
    const r = await fetch(`${BASE}/volatility/term-structure/${symbol}`)
    if (!r.ok) throw new Error(`API error ${r.status}`)
    return r.json()
  },

  async getCrossVol(): Promise<CrossVolResponse> {
    const r = await fetch(`${BASE}/breadth/cross-vol`)
    if (!r.ok) throw new Error(`API error ${r.status}`)
    return r.json()
  },

  async getRiskAdjRanking(horizon = '1m'): Promise<RiskAdjResponse> {
    const r = await fetch(`${BASE}/risk-adjusted-ranking?horizon=${horizon}`)
    if (!r.ok) throw new Error(`API error ${r.status}`)
    return r.json()
  },

  async getCalendar(symbol: string, year: number): Promise<CalendarResponse> {
    const r = await fetch(`${BASE}/calendar/${symbol}?year=${year}`)
    if (!r.ok) throw new Error(`API error ${r.status}`)
    return r.json()
  },

  async getMultiSMA(): Promise<MultiSMAResponse> {
    const r = await fetch(`${BASE}/breadth/multi-sma`)
    if (!r.ok) throw new Error(`API error ${r.status}`)
    return r.json()
  },

  async getAdvanceDecline(): Promise<ADResponse> {
    const r = await fetch(`${BASE}/breadth/advance-decline`)
    if (!r.ok) throw new Error(`API error ${r.status}`)
    return r.json()
  },

  async getCorrMatrix(horizon = 'ret_1d', lookback = 252): Promise<CorrMatrixResponse> {
    const r = await fetch(`${BASE}/correlation/matrix?horizon=${horizon}&lookback=${lookback}`)
    if (!r.ok) throw new Error(`API error ${r.status}`)
    return r.json()
  },

  async getAlphaBeta(horizon = 'ret_1d', lookback = 252): Promise<AlphaBetaResponse> {
    const r = await fetch(`${BASE}/factor/alpha-beta?horizon=${horizon}&lookback=${lookback}`)
    if (!r.ok) throw new Error(`API error ${r.status}`)
    return r.json()
  },
}
