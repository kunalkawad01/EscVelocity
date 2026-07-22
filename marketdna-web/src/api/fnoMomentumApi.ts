import type { FnoMomentumResponse } from '../types/fnoMomentum'

// Relative path so requests go through Vite's dev proxy (→ 127.0.0.1:8000),
// same as fnoApi — avoids IPv6 localhost resolution issues.
const BASE = '/api/fno-momentum'

function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(r.statusText)
  return r.json() as Promise<T>
}

export const fnoMomentumApi = {
  getScan: (): Promise<FnoMomentumResponse> =>
    fetch(`${BASE}/scan`).then(json<FnoMomentumResponse>),

  invalidate: (): Promise<void> =>
    fetch(`${BASE}/invalidate`, { method: 'POST' }).then(() => undefined),
}
