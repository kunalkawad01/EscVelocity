import type { IntelligenceData, LiveQuote, Fundamentals } from '../types/intelligence'

const BASE = '/api/intelligence'

async function request<T>(url: string, method = 'GET'): Promise<T> {
  const res = await fetch(url, { method })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detail?.detail ?? `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const intelligenceApi = {
  analyze: (ticker: string) =>
    request<IntelligenceData>(`${BASE}/${ticker.toUpperCase()}`, 'POST'),

  getQuote: (ticker: string) =>
    request<LiveQuote>(`${BASE}/quote/${ticker.toUpperCase()}`),

  getFundamentals: (ticker: string) =>
    request<Fundamentals>(`${BASE}/fundamentals/${ticker.toUpperCase()}`),

  invalidateCache: (ticker: string) =>
    request<{ status: string; ticker: string }>(`${BASE}/cache/${ticker.toUpperCase()}`, 'DELETE'),

  getCacheStatus: (ticker: string) =>
    request<{ ticker: string; cached: boolean; fresh: boolean; fetched_at: string | null }>(
      `${BASE}/cache/status/${ticker.toUpperCase()}`
    ),
}
