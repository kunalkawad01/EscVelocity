import type { ShortIntelligenceResult } from '../types/short'

const BASE = ''

export const shortApi = {
  getIntelligence: async (): Promise<ShortIntelligenceResult> => {
    const res = await fetch(`${BASE}/api/short/intelligence`)
    if (!res.ok) throw new Error(`Short API ${res.status}`)
    return res.json()
  },
  invalidate: async (): Promise<void> => {
    await fetch(`${BASE}/api/short/invalidate`, { method: 'POST' })
  },
}
