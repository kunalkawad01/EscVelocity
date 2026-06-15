/**
 * Fetches the full NSE 500 symbol list once at module load, caches permanently.
 * All components share the same fetch — no duplicate requests.
 */
let _cache: string[] | null = null
let _promise: Promise<string[]> | null = null

function fetchSymbols(): Promise<string[]> {
  if (_cache) return Promise.resolve(_cache)
  if (!_promise) {
    _promise = fetch('/api/stock/symbols')
      .then(r => r.json())
      .then((d: { symbols: string[] }) => {
        _cache = [...d.symbols].sort()
        return _cache
      })
      .catch(() => {
        _promise = null
        return [] as string[]
      })
  }
  return _promise
}

import { useState, useEffect } from 'react'

export function useSymbols(): string[] {
  const [symbols, setSymbols] = useState<string[]>(_cache ?? [])

  useEffect(() => {
    if (_cache) { setSymbols(_cache); return }
    fetchSymbols().then(s => { if (s.length) setSymbols(s) })
  }, [])

  return symbols
}
