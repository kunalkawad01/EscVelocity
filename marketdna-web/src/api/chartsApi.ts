import type { ChartsSymbolsResponse, ChartsHistoryResponse, ChartsHistoryForDateResponse, ChartsIndicatorsResponse, ChartsReferenceOpenResponse, ChartsScreenerStatsResponse, ChartsTf, ChartsOneDInterval } from '../types/charts'

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

  // `interval` only matters for tf='1d' ('1m'/'5m') -- ignored server-side for
  // every other timeframe, so callers for those tfs can simply omit it.
  getHistory: (symbol: string, tf: ChartsTf, interval: ChartsOneDInterval = '1m'): Promise<ChartsHistoryResponse> =>
    fetch(`${BASE}/history?symbol=${encodeURIComponent(symbol)}&tf=${tf}&interval=${interval}`).then(json<ChartsHistoryResponse>),

  // Intraday candles for one exact past date (YYYY-MM-DD), not a relative tf.
  // A closed trading day's candles are immutable -- safe to fetch once and keep.
  getHistoryForDate: (symbol: string, date: string, interval = '5minute'): Promise<ChartsHistoryForDateResponse> =>
    fetch(`${BASE}/history-for-date?symbol=${encodeURIComponent(symbol)}&date=${date}&interval=${interval}`).then(json<ChartsHistoryForDateResponse>),

  // Slow (~70s) on the first request per tf -- see ChartsIndicatorsResponse. Callers
  // should gate this behind an explicit action, not fire it on every keystroke.
  getIndicators: (tf: ChartsTf): Promise<ChartsIndicatorsResponse> =>
    fetch(`${BASE}/indicators?tf=${tf}`).then(json<ChartsIndicatorsResponse>),

  // Slow (~70s) cold, same shape as getIndicators -- see ChartsReferenceOpenResponse.
  // Gate behind an explicit action, not every render.
  getReferenceOpen: (minute = '09:18'): Promise<ChartsReferenceOpenResponse> =>
    fetch(`${BASE}/reference-open?minute=${minute}`).then(json<ChartsReferenceOpenResponse>),

  // Fast even cold (~4s for the whole F&O universe) -- a single local DuckDB
  // aggregation, no Kite calls -- so this is safe to fetch eagerly on mount.
  getScreenerStats: (years = 5): Promise<ChartsScreenerStatsResponse> =>
    fetch(`${BASE}/screener-stats?years=${years}`).then(json<ChartsScreenerStatsResponse>),

  // ws:// URL for the live-tick stream. Uses the current page's host so it rides
  // through Vite's dev proxy (see vite.config.ts `/ws` entry) exactly like fetch
  // requests ride through the `/api` proxy — never hardcode localhost:8000 here.
  wsUrl: (): string => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}/ws/charts`
  },
}
