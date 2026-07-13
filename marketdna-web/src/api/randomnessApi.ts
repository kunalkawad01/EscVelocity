import type { RandomnessReport } from '../types/randomness'

// Relative path → Vite proxy (127.0.0.1:8000). Avoids hardcoded `localhost:8000`, which
// browsers may resolve to IPv6 `::1` where the IPv4-only backend isn't listening.
const BASE = '/api/randomness'

export const randomnessApi = {
  getReport: (symbol: string): Promise<RandomnessReport> =>
    fetch(`${BASE}/${symbol}`).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() }),

  invalidate: (symbol: string): Promise<void> =>
    fetch(`${BASE}/${symbol}/invalidate`, { method: 'POST' }).then(() => undefined),
}
