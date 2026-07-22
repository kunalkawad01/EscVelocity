import type { DriversCoverageResponse, StockDriversResponse } from '../types/drivers'

const BASE = '/api/drivers'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export const driversApi = {
  // 404s for symbols without a dossier — callers should catch and treat as "no coverage"
  getDrivers: (symbol: string) => get<StockDriversResponse>(`${BASE}/${symbol}`),
  getCoverage: () => get<DriversCoverageResponse>(`${BASE}/coverage`),
}
