import type { MarkovOptionsResult, MarketMarkovResult } from '../types/markov_options'

const BASE = '/api/markov-options'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export const markovOptionsApi = {
  getSymbol:          (symbol: string) => get<MarkovOptionsResult>(`${BASE}/${symbol}`),
  getMarket:          ()               => get<MarketMarkovResult>(`${BASE}/market`),
  invalidateCache:    ()               => fetch(`${BASE}/market/invalidate`, { method: 'POST' }).then(r => r.json() as Promise<{ status: string }>),
}
