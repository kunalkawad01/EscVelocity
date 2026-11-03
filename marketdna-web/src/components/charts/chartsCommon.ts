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

// All 16 (timeframe x direction) cart sections in display order, e.g. "1D Bullish",
// "1D Bearish", "2D Bullish", ... -- shared by the Charts page's cart drawer and the
// full Chart Cart page so both group cart items identically.
export const CART_SECTIONS: Array<{ tf: ChartsTf; direction: CartDirection }> = CHARTS_TFS.flatMap(tf => [
  { tf, direction: 'bullish' as CartDirection },
  { tf, direction: 'bearish' as CartDirection },
])
