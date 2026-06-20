import type { RandomnessReport } from '../types/randomness'

const BASE = 'http://localhost:8000/api/randomness'

export const randomnessApi = {
  getReport: (symbol: string): Promise<RandomnessReport> =>
    fetch(`${BASE}/${symbol}`).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() }),

  invalidate: (symbol: string): Promise<void> =>
    fetch(`${BASE}/${symbol}/invalidate`, { method: 'POST' }).then(() => undefined),
}
