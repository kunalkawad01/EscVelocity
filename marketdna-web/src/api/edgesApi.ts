// src/api/edgesApi.ts — Edge Decay Observatory
// Relative paths -> Vite proxy (127.0.0.1:8000), same convention as the other APIs.
import type {
  ObservatoryResponse, EdgeHistoryResponse, FieldHealthResponse, EdgeReportResponse,
} from '../types/edges'

const BASE = '/api/edges'

function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json() as Promise<T>
}

export const edgesApi = {
  getObservatory: (universe = 'nifty500'): Promise<ObservatoryResponse> =>
    fetch(`${BASE}/observatory?universe=${universe}`).then(json<ObservatoryResponse>),

  getHistory: (edgeKey: string, universe = 'nifty500'): Promise<EdgeHistoryResponse> =>
    fetch(`${BASE}/${edgeKey}/history?universe=${universe}`).then(json<EdgeHistoryResponse>),

  getFieldHealth: (universe = 'nifty500'): Promise<FieldHealthResponse> =>
    fetch(`${BASE}/field-health?universe=${universe}`).then(json<FieldHealthResponse>),

  getReport: (universe = 'nifty500'): Promise<EdgeReportResponse> =>
    fetch(`${BASE}/report?universe=${universe}`).then(json<EdgeReportResponse>),

  invalidate: (): Promise<void> =>
    fetch(`${BASE}/invalidate`, { method: 'POST' }).then(() => undefined),
}
