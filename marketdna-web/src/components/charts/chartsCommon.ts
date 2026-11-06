import { CHARTS_TFS } from '../../types/charts'
import type { ChartsTf } from '../../types/charts'
import type { CartDirection } from '../../hooks/useChartsCart'

export const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
export const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
export const GREEN = '#22c55e'
export const RED = '#ef4444'

export const TF_LABELS: Record<ChartsTf, string> = {
  '1d': '1D', '2d': '2D', '5d': '5D', '1mo': '1M', '3mo': '3M', ytd: 'YTD', '1y': '1Y', '5y': '5Y',
}

export const pct = (v: number | null | undefined, dp = 2) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(dp) + '%'

// Generic op/threshold filter value, shared by the backend-scan-based indicator
// filters (RSI/ATR/Returns%, useIndicatorFilters) and the live tick-based return
// filters (vs prev close/open/high/low, useLiveReturnFilters) -- same shape, same
// matching rule, two different data sources.
export type FilterOp = '<' | '>'
export interface FilterValue {
  op: FilterOp
  value: string
}
export const EMPTY_FILTER: FilterValue = { op: '<', value: '' }

export function matchesFilter(f: FilterValue, v: number | null): boolean {
  if (!f.value.trim()) return true           // blank textbox -- this filter isn't active
  const threshold = parseFloat(f.value)
  if (Number.isNaN(threshold)) return true
  if (v == null) return false                // couldn't compute this value for the symbol
  return f.op === '<' ? v < threshold : v > threshold
}

// % difference of `value` from `base`, or null if base is missing/zero (e.g. a tick
// that hasn't carried today's open/high/low yet) -- never divide by a falsy base.
export function pctFrom(value: number, base: number | undefined): number | null {
  if (!base) return null
  return ((value - base) / base) * 100
}

// All 16 (timeframe x direction) cart sections in display order, e.g. "1D Bullish",
// "1D Bearish", "2D Bullish", ... -- shared by the Charts page's cart drawer and the
// full Chart Cart page so both group cart items identically.
export const CART_SECTIONS: Array<{ tf: ChartsTf; direction: CartDirection }> = CHARTS_TFS.flatMap(tf => [
  { tf, direction: 'bullish' as CartDirection },
  { tf, direction: 'bearish' as CartDirection },
])
