import type { RegimeScoreResult, BreadthScoreResult, MarketRegimeSnapshot } from '../types/regime'

const BASE = '/api/regime'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export const regimeApi = {
  getRegime:   (symbol: string) => get<RegimeScoreResult>(`${BASE}/${symbol}`),
  getBreadth:  ()               => get<BreadthScoreResult>(`${BASE}/breadth`),
  getSnapshot: ()               => get<MarketRegimeSnapshot>(`${BASE}/snapshot`),
  invalidate:  ()               => fetch(`${BASE}/invalidate`, { method: 'POST' }).then(r => r.json() as Promise<{ status: string }>),
}
