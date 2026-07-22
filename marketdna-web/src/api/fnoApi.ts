import type {
  MarketState, FnoUniverseResponse, BreadthVerdict, NormalizedSeries,
  OptionChainResponse, StrikeChartResponse, FnoChatResponse,
} from '../types/fno'

// Relative path so requests go through Vite's dev proxy (→ 127.0.0.1:8000) like every
// other API. Avoids the hardcoded `localhost:8000`, which browsers may resolve to IPv6
// `::1` — where the IPv4-only backend isn't listening, causing "no data" on this page.
const BASE = '/api/fno'

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

  chat: (question: string): Promise<FnoChatResponse> =>
    fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    }).then(json<FnoChatResponse>),
}
