import type {
  NiftyIndexTick, ContributorsResponse, ConstituentsResponse, NiftyTf, NiftyHistoryResponse, MoversResponse,
  AdvanceDeclineResponse, VixState, PcrHistoryResponse,
} from '../types/nifty50'

// Relative path so requests go through Vite's dev proxy (→ 127.0.0.1:8000) like every
// other API. Avoids the hardcoded `localhost:8000`, which browsers may resolve to IPv6
// `::1` — where the IPv4-only backend isn't listening, causing "no data" on this page.
const BASE = '/api/nifty50'

function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(r.statusText)
  return r.json() as Promise<T>
}

export const nifty50Api = {
  getState: (): Promise<NiftyIndexTick> =>
    fetch(`${BASE}/state`).then(json<NiftyIndexTick>),

  getContributors: (limit = 10): Promise<ContributorsResponse> =>
    fetch(`${BASE}/contributors?limit=${limit}`).then(json<ContributorsResponse>),

  getConstituents: (): Promise<ConstituentsResponse> =>
    fetch(`${BASE}/constituents`).then(json<ConstituentsResponse>),

  // symbol omitted -> NIFTY 50 index itself; pass an NSE tradingsymbol for a constituent.
  getHistory: (tf: NiftyTf, symbol?: string): Promise<NiftyHistoryResponse> =>
    fetch(`${BASE}/history?tf=${tf}${symbol ? `&symbol=${symbol}` : ''}`).then(json<NiftyHistoryResponse>),

  getExpiries: (): Promise<string[]> =>
    fetch(`${BASE}/option-chain/expiries`).then(json<{ expiries: string[] }>).then(d => d.expiries),

  getMovers: (): Promise<MoversResponse> =>
    fetch(`${BASE}/movers`).then(json<MoversResponse>),

  getBreadth: (): Promise<AdvanceDeclineResponse> =>
    fetch(`${BASE}/breadth`).then(json<AdvanceDeclineResponse>),

  getVixState: (): Promise<VixState> =>
    fetch(`${BASE}/vix-state`).then(json<VixState>),

  getPcrHistory: (expiry?: string): Promise<PcrHistoryResponse> =>
    fetch(`${BASE}/pcr-history${expiry ? `?expiry=${expiry}` : ''}`).then(json<PcrHistoryResponse>),

  // ws:// URL for the live index-tick stream. Uses the current page's host so it
  // rides through Vite's dev proxy (see vite.config.ts `/ws` entry) exactly like
  // fetch requests ride through the `/api` proxy — never hardcode localhost:8000 here.
  wsUrl: (): string => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}/ws/nifty50`
  },
}
