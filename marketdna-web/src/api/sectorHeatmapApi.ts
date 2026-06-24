import { SectorHeatmapResponse } from '../types/sector_heatmap'

const BASE = '/api/sector-heatmap'

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<T>
}

export const sectorHeatmapApi = {
  getHeatmap: (universe = 'nifty500') =>
    get<SectorHeatmapResponse>(`${BASE}?universe=${universe}`),

  invalidate: (universe?: string) => {
    const q = universe ? `?universe=${universe}` : ''
    return fetch(`${BASE}/invalidate${q}`, { method: 'POST' })
  },
}
