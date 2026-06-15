import type { StockHealthReport, ArchetypeScanResponse } from '../types/stock_health'

const BASE = '/api/stock-health'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export const stockHealthApi = {
  getScan: () => get<ArchetypeScanResponse>(`${BASE}/scan`),
  getReport: (symbol: string) => get<StockHealthReport>(`${BASE}/${symbol}`),
  invalidate: async (symbol: string): Promise<void> => {
    await fetch(`${BASE}/${symbol}/invalidate`, { method: 'POST' })
  },
}
