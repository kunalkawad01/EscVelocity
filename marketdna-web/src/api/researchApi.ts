// Research Copilot API client — /api/research

const BASE = '/api/research'

export interface ManifestStep {
  tool: string
  input: Record<string, unknown>
  result_hash: string
  ms: number
}

export interface ResearchManifest {
  data_version: string
  methodology_version: string
  seed: number
  reproducible: boolean
  steps: ManifestStep[]
}

export interface ResearchArtifact {
  tool: string
  input: Record<string, unknown>
  result: any
}

export interface ResearchChatResponse {
  answer: string
  manifest: ResearchManifest
  artifacts: ResearchArtifact[]
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export const researchApi = {
  chat: (question: string, universe = 'nse500') =>
    postJSON<ResearchChatResponse>(`${BASE}/chat`, { question, universe }),
  screen: (criteria: unknown[], universe = 'nse500', sort_by?: string, limit = 50) =>
    postJSON<any>(`${BASE}/screen`, { criteria, universe, sort_by, limit }),
  eda: (symbol: string) => get<any>(`${BASE}/eda/${symbol}`),
  dataVersion: () => get<{ data_version: string }>(`${BASE}/data-version`),
}
