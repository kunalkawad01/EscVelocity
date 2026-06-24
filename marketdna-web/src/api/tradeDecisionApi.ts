import type {
  AnalyzeRequest, TradeBriefResponse,
  ScanRequest, ScanResponse,
} from '../types/trade_decision'

const BASE = '/api/trade-decision'

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export const tradeDecisionApi = {
  analyze: (req: AnalyzeRequest) =>
    post<TradeBriefResponse>(`${BASE}/analyze`, req),

  scan: (req: Partial<ScanRequest> = {}) =>
    post<ScanResponse>(`${BASE}/scan`, {
      instrument_types: ['EQUITY'],
      min_confidence:   55,
      max_results:      20,
      ...req,
    }),
}
