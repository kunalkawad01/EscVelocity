import type { OIAnalysis, OIScannerResponse, ExpectedMoveHistory, EMScanResponse } from '../types/options'

const BASE = 'http://localhost:8000/api/options'

export const optionsApi = {
  getOIAnalysis: (symbol: string): Promise<OIAnalysis> =>
    fetch(`${BASE}/${symbol}`).then(r => {
      if (!r.ok) throw new Error(r.statusText)
      return r.json()
    }),

  invalidateSymbol: (symbol: string): Promise<void> =>
    fetch(`${BASE}/${symbol}/invalidate`, { method: 'POST' }).then(() => undefined),

  getScanner: (): Promise<OIScannerResponse> =>
    fetch(`${BASE}/scan/all`).then(r => {
      if (!r.ok) throw new Error(r.statusText)
      return r.json()
    }),

  invalidateScanner: (): Promise<void> =>
    fetch(`${BASE}/scan/invalidate`, { method: 'POST' }).then(() => undefined),

  getExpectedMove: (symbol: string): Promise<ExpectedMoveHistory> =>
    fetch(`${BASE}/${symbol}/expected-move`).then(r => {
      if (!r.ok) throw new Error(r.statusText)
      return r.json()
    }),

  invalidateExpectedMove: (symbol: string): Promise<void> =>
    fetch(`${BASE}/${symbol}/expected-move/invalidate`, { method: 'POST' }).then(() => undefined),

  getEMScan: (): Promise<EMScanResponse> =>
    fetch(`${BASE}/em-scan`).then(r => {
      if (!r.ok) throw new Error(r.statusText)
      return r.json()
    }),

  invalidateEMScan: (): Promise<void> =>
    fetch(`${BASE}/em-scan/invalidate`, { method: 'POST' }).then(() => undefined),
}
