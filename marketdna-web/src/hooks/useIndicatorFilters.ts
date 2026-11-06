import { useCallback, useState } from 'react'
import { chartsApi } from '../api/chartsApi'
import { EMPTY_FILTER, matchesFilter as matches } from '../components/charts/chartsCommon'
import type { FilterOp, FilterValue } from '../components/charts/chartsCommon'
import type { ChartsIndicatorEntry, ChartsTf } from '../types/charts'

export type { FilterOp }
export type IndicatorFilterValue = FilterValue

// RSI / ATR% / Returns% filters, shared by /charts and /chart-cart. The indicator
// snapshot is a bulk backend scan (slow cold, ~70s for the full F&O universe) so it's
// fetched once via apply() -- never refetched on every keystroke -- and then every
// filter/threshold change re-evaluates against the already-fetched snapshot in memory.
export function useIndicatorFilters() {
  const [tf, setTf] = useState<ChartsTf>('1d')
  const [rsi, setRsi] = useState<IndicatorFilterValue>(EMPTY_FILTER)
  const [atr, setAtr] = useState<IndicatorFilterValue>(EMPTY_FILTER)
  const [returns, setReturns] = useState<IndicatorFilterValue>(EMPTY_FILTER)
  const [snapshot, setSnapshot] = useState<Record<string, ChartsIndicatorEntry>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [computedAt, setComputedAt] = useState<string | null>(null)

  const hasSnapshot = Object.keys(snapshot).length > 0
  const active = hasSnapshot && Boolean(rsi.value.trim() || atr.value.trim() || returns.value.trim())

  const apply = useCallback(() => {
    setLoading(true)
    setError(null)
    chartsApi.getIndicators(tf)
      .then(r => {
        if (r.error) {
          setError(r.error)
          setSnapshot({})
          return
        }
        setSnapshot(r.indicators)
        setComputedAt(r.computed_at ?? null)
      })
      .catch(() => setError('Failed to load indicator snapshot'))
      .finally(() => setLoading(false))
  }, [tf])

  const clear = useCallback(() => {
    setRsi(EMPTY_FILTER)
    setAtr(EMPTY_FILTER)
    setReturns(EMPTY_FILTER)
    setSnapshot({})
    setComputedAt(null)
    setError(null)
  }, [])

  const passes = useCallback((symbol: string) => {
    if (!active) return true
    const entry = snapshot[symbol]
    if (!entry) return false
    return matches(rsi, entry.rsi) && matches(atr, entry.atr_pct) && matches(returns, entry.return_pct)
  }, [active, snapshot, rsi, atr, returns])

  return {
    tf, setTf,
    rsi, setRsi,
    atr, setAtr,
    returns, setReturns,
    apply, clear,
    loading, error, computedAt,
    hasSnapshot, active,
    passes,
  }
}

export type UseIndicatorFilters = ReturnType<typeof useIndicatorFilters>
