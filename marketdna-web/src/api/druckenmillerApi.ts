import type { ROC2StockResult, ROC2ScanResult } from '../types/druckenmiller_roc'

const BASE = '/api/roc2'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export const druckenmillerApi = {
  getScan: () => get<ROC2ScanResult>(`${BASE}/scan`),
  getStock: (symbol: string) => get<ROC2StockResult>(`${BASE}/${symbol}`),
  invalidate: () => fetch(`${BASE}/invalidate`, { method: 'POST' }),
}
