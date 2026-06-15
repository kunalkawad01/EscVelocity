import type { CointegrationScanResult } from '../types/cointegration'

const BASE = '/api/cointegration'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export const cointegrationApi = {
  getScan:     () => get<CointegrationScanResult>(`${BASE}/scan`),
  invalidate:  () => fetch(`${BASE}/invalidate`, { method: 'POST' }).then(r => r.json()),
}
