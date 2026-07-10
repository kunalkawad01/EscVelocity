import type {
  MarketState, FnoUniverseResponse, BreadthVerdict, NormalizedSeries,
  OptionChainResponse, StrikeChartResponse,
} from '../types/fno'

const BASE = 'http://localhost:8000/api/fno'

function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(r.statusText)
  return r.json() as Promise<T>
}

export const fnoApi = {
  getState: (): Promise<MarketState> =>
    fetch(`${BASE}/state`).then(json<MarketState>),

  getUniverse: (): Promise<FnoUniverseResponse> =>
    fetch(`${BASE}/universe`).then(json<FnoUniverseResponse>),

  getBreadth: (): Promise<BreadthVerdict> =>
    fetch(`${BASE}/breadth`).then(json<BreadthVerdict>),

  getNormalized: (symbols?: string[]): Promise<NormalizedSeries> => {
    const qs = symbols && symbols.length ? `?symbols=${symbols.join(',')}` : ''
    return fetch(`${BASE}/normalized${qs}`).then(json<NormalizedSeries>)
  },

  getOptionChain: (symbol: string): Promise<OptionChainResponse> =>
    fetch(`${BASE}/optionchain/${symbol}`).then(json<OptionChainResponse>),

  getStrikeChart: (symbol: string, strike: number, expiry: string): Promise<StrikeChartResponse> =>
    fetch(`${BASE}/optionchain/${symbol}/strike-chart?strike=${strike}&expiry=${expiry}`)
      .then(json<StrikeChartResponse>),

  invalidate: (): Promise<void> =>
    fetch(`${BASE}/invalidate`, { method: 'POST' }).then(() => undefined),
}
