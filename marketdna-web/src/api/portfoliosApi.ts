// src/api/portfoliosApi.ts
import type {
  PortfolioListResponse, ScreenResponse, BacktestResponse, LiveResponse, TrackResponse, Universe,
  PortfolioSpec, PortfolioMeta, FieldCatalogResponse, NLDraftResponse,
} from '../types/portfolios'

const BASE = ''

/** Extract FastAPI's `detail` (rule errors, conflicts) for a friendly message. */
async function errDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.detail === 'string') return body.detail
    if (Array.isArray(body?.detail)) return body.detail.map((d: any) => d.msg).join('; ')
  } catch { /* non-JSON */ }
  return `${fallback} (${res.status})`
}

export const portfoliosApi = {
  list: async (): Promise<PortfolioListResponse> => {
    const res = await fetch(`${BASE}/api/portfolios/list`)
    if (!res.ok) throw new Error(`Portfolios API ${res.status}`)
    return res.json()
  },
  getScreen: async (key: string, universe: Universe = 'nifty500', size?: number): Promise<ScreenResponse> => {
    const params = new URLSearchParams({ universe })
    if (size) params.set('size', String(size))
    const res = await fetch(`${BASE}/api/portfolios/screen/${key}?${params}`)
    if (!res.ok) throw new Error(`Screen API ${res.status}`)
    return res.json()
  },
  getBacktest: async (
    key: string, universe: Universe = 'nifty500', freq: 'W' | 'M' | 'Q' = 'M',
  ): Promise<BacktestResponse> => {
    const params = new URLSearchParams({ universe, freq })
    const res = await fetch(`${BASE}/api/portfolios/backtest/${key}?${params}`)
    if (!res.ok) throw new Error(`Backtest API ${res.status}`)
    return res.json()
  },
  getTrack: async (key: string, universe: Universe = 'nifty500'): Promise<TrackResponse> => {
    const params = new URLSearchParams({ universe })
    const res = await fetch(`${BASE}/api/portfolios/track/${key}?${params}`)
    if (!res.ok) throw new Error(`Track API ${res.status}`)
    return res.json()
  },
  getLive: async (key: string, universe: Universe = 'nifty500'): Promise<LiveResponse> => {
    const params = new URLSearchParams({ universe })
    const res = await fetch(`${BASE}/api/portfolios/live/${key}?${params}`)
    if (!res.ok) throw new Error(`Live API ${res.status}`)
    return res.json()
  },
  invalidate: async (): Promise<void> => {
    await fetch(`${BASE}/api/portfolios/invalidate`, { method: 'POST' })
  },

  // ── custom (user-defined) portfolios ──
  getFields: async (): Promise<FieldCatalogResponse> => {
    const res = await fetch(`${BASE}/api/portfolios/custom/fields`)
    if (!res.ok) throw new Error(`Fields API ${res.status}`)
    return res.json()
  },
  draftFromText: async (description: string, universe: Universe = 'nifty500'): Promise<NLDraftResponse> => {
    const res = await fetch(`${BASE}/api/portfolios/custom/from-text`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, universe }),
    })
    if (!res.ok) throw new Error(await errDetail(res, 'Generate failed'))
    return res.json()
  },
  getCustomSpec: async (key: string): Promise<PortfolioSpec> => {
    const res = await fetch(`${BASE}/api/portfolios/custom/${key}/spec`)
    if (!res.ok) throw new Error(await errDetail(res, 'Load spec failed'))
    return res.json()
  },
  createCustom: async (spec: PortfolioSpec): Promise<PortfolioMeta> => {
    const res = await fetch(`${BASE}/api/portfolios/custom`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec),
    })
    if (!res.ok) throw new Error(await errDetail(res, 'Create failed'))
    return res.json()
  },
  updateCustom: async (key: string, spec: PortfolioSpec): Promise<PortfolioMeta> => {
    const res = await fetch(`${BASE}/api/portfolios/custom/${key}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec),
    })
    if (!res.ok) throw new Error(await errDetail(res, 'Update failed'))
    return res.json()
  },
  deleteCustom: async (key: string): Promise<void> => {
    const res = await fetch(`${BASE}/api/portfolios/custom/${key}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(await errDetail(res, 'Delete failed'))
  },
}
