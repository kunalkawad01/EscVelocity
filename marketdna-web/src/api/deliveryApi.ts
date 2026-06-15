import type { DeliveryReport, DeliverySummaryResult } from '../types/delivery'

const BASE = '/api/delivery'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export const deliveryApi = {
  getSummary: ()             => get<DeliverySummaryResult>(`${BASE}/summary`),
  getReport:  (symbol: string) => get<DeliveryReport>(`${BASE}/${symbol}`),
  invalidate: ()             => fetch(`${BASE}/invalidate`, { method: 'POST' }).then(r => r.json()),
}
