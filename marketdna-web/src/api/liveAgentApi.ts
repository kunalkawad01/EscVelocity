// Live Agent API client — /api/live-agent (read-only)

const BASE = '/api/live-agent'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}
async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export interface LiveScan {
  state: any
  changes: any
  board: any
}
export interface LiveChatResponse {
  answer: string
  manifest: { data_version: string; methodology_version: string; steps: any[] }
  artifacts: { tool: string; input: any; result: any }[]
}

export const liveAgentApi = {
  scan: (universe = 'nifty50') => get<LiveScan>(`${BASE}/scan?universe=${universe}`),
  chat: (question: string, universe = 'nifty50') =>
    postJSON<LiveChatResponse>(`${BASE}/chat`, { question, universe }),
  events: (limit = 30) => get<{ events: any[]; count: number }>(`${BASE}/events?limit=${limit}`),
  why: (symbol: string) => get<any>(`${BASE}/why/${symbol}`),
}
