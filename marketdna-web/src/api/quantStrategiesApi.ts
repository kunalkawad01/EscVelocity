import type { QuantScanResult } from '../types/quant_strategies'

const BASE = '/api/quant'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export const quantStrategiesApi = {
  scan:      ()  => get<QuantScanResult>(`${BASE}/scan`),
  invalidate: () => fetch(`${BASE}/invalidate`, { method: 'POST' }).then(r => r.json() as Promise<{ status: string }>),
}
