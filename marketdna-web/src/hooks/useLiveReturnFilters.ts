import { useCallback, useState } from 'react'
import { EMPTY_FILTER, matchesFilter, pctFrom } from '../components/charts/chartsCommon'
import type { FilterValue } from '../components/charts/chartsCommon'
import type { ChartsTick } from '../types/charts'

// Four return filters computed straight off the live /ws/charts tick -- vs
// yesterday's close (the tick's own gap-inclusive change_pct), vs today's open,
// vs today's high (how far below the session high, typically <= 0), vs today's
// low (how far above the session low, typically >= 0). Unlike useIndicatorFilters
// (RSI/ATR/Returns%, which needs a slow bulk backend scan over historical candles
// per timeframe), this needs no network call and no "Apply" step -- it just
// re-evaluates against whatever ticks are already streaming.
export function useLiveReturnFilters(ticks: Record<string, ChartsTick>) {
  const [vsPrevClose, setVsPrevClose] = useState<FilterValue>(EMPTY_FILTER)
  const [vsOpen, setVsOpen] = useState<FilterValue>(EMPTY_FILTER)
  const [vsHigh, setVsHigh] = useState<FilterValue>(EMPTY_FILTER)
  const [vsLow, setVsLow] = useState<FilterValue>(EMPTY_FILTER)

  const active = Boolean(
    vsPrevClose.value.trim() || vsOpen.value.trim() || vsHigh.value.trim() || vsLow.value.trim(),
  )

  const clear = useCallback(() => {
    setVsPrevClose(EMPTY_FILTER)
    setVsOpen(EMPTY_FILTER)
    setVsHigh(EMPTY_FILTER)
    setVsLow(EMPTY_FILTER)
  }, [])

  const passes = useCallback((symbol: string) => {
    if (!active) return true
    const t = ticks[symbol]
    if (!t) return false
    const retPrevClose = t.prev_close ? t.change_pct : null
    const retOpen = pctFrom(t.ltp, t.open)
    const retHigh = pctFrom(t.ltp, t.high)
    const retLow = pctFrom(t.ltp, t.low)
    return (
      matchesFilter(vsPrevClose, retPrevClose) &&
      matchesFilter(vsOpen, retOpen) &&
      matchesFilter(vsHigh, retHigh) &&
      matchesFilter(vsLow, retLow)
    )
  }, [active, ticks, vsPrevClose, vsOpen, vsHigh, vsLow])

  return {
    vsPrevClose, setVsPrevClose,
    vsOpen, setVsOpen,
    vsHigh, setVsHigh,
    vsLow, setVsLow,
    active, clear,
    passes,
  }
}

export type UseLiveReturnFilters = ReturnType<typeof useLiveReturnFilters>
