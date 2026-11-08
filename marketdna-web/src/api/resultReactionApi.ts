import type { ResultReactionScanResponse } from '../types/resultReaction'

const BASE = '/api/result-reaction'

function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(r.statusText)
  return r.json() as Promise<T>
}

export const resultReactionApi = {
  getScan: (): Promise<ResultReactionScanResponse> =>
    fetch(`${BASE}/scan`).then(json<ResultReactionScanResponse>),

  invalidate: (): Promise<{ status: string }> =>
    fetch(`${BASE}/scan/invalidate`, { method: 'POST' }).then(json<{ status: string }>),
}
