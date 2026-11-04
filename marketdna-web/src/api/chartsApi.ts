import type { ChartsSymbolsResponse, ChartsHistoryResponse, ChartsIndicatorsResponse, ChartsTf } from '../types/charts'

// Relative path so requests go through Vite's dev proxy (→ 127.0.0.1:8000) like every
// other API. Avoids the hardcoded `localhost:8000`, which browsers may resolve to IPv6
// `::1` — where the IPv4-only backend isn't listening, causing "no data" on this page.
const BASE = '/api/charts'

function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(r.statusText)
  return r.json() as Promise<T>
}

export const chartsApi = {
  getSymbols: (): Promise<ChartsSymbolsResponse> =>
    fetch(`${BASE}/symbols`).then(json<ChartsSymbolsResponse>),

  getHistory: (symbol: string, tf: ChartsTf): Promise<ChartsHistoryResponse> =>
    fetch(`${BASE}/history?symbol=${encodeURIComponent(symbol)}&tf=${tf}`).then(json<ChartsHistoryResponse>),

  // Slow (~70s) on the first request per tf -- see ChartsIndicatorsResponse. Callers
  // should gate this behind an explicit action, not fire it on every keystroke.
  getIndicators: (tf: ChartsTf): Promise<ChartsIndicatorsResponse> =>
    fetch(`${BASE}/indicators?tf=${tf}`).then(json<ChartsIndicatorsResponse>),

  // ws:// URL for the live-tick stream. Uses the current page's host so it rides
  // through Vite's dev proxy (see vite.config.ts `/ws` entry) exactly like fetch
  // requests ride through the `/api` proxy — never hardcode localhost:8000 here.
  wsUrl: (): string => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}/ws/charts`
  },
}
