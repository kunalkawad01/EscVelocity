import { useCallback, useState } from 'react'
import { giveBackPct, pctFrom, recoveryPct } from '../components/charts/chartsCommon'
import type { ChartsTick, ScreenerSymbolStats } from '../types/charts'

export type ScreenerField =
  | 'vsPrevClose' | 'vsOpen' | 'vsHigh' | 'vsLow'
  | 'giveBack' | 'recovery' | 'lowVsOpen' | 'highVsOpen'
  | 'vsSMA20' | 'vsSMA50' | 'vsSMA100' | 'vsSMA200'

export const SCREENER_FIELDS: ScreenerField[] = [
  'vsPrevClose', 'vsOpen', 'vsHigh', 'vsLow',
  'giveBack', 'recovery', 'lowVsOpen', 'highVsOpen',
  'vsSMA20', 'vsSMA50', 'vsSMA100', 'vsSMA200',
]

export const SCREENER_FIELD_LABELS: Record<ScreenerField, string> = {
  vsPrevClose: 'vs Yday Close',
  vsOpen: 'vs Today Open',
  vsHigh: 'vs Today High',
  vsLow: 'vs Today Low',
  giveBack: 'Give-back %',
  recovery: 'Recovery %',
  lowVsOpen: 'Low vs Open %',
  highVsOpen: 'High vs Open %',
  vsSMA20: 'vs SMA20',
  vsSMA50: 'vs SMA50',
  vsSMA100: 'vs SMA100',
  vsSMA200: 'vs SMA200',
}

// '<' / '>' compare against `value`; 'between' compares against the inclusive
// range [value, value2] (order-independent -- a trader typing "90 and 60" gets
// the same range as "60 and 90"). 'between' is unavailable in percentile mode
// (see ScreenerCondition.pctileMode) -- a condition is already < or > one
// percentile breakpoint there, not a fixed numeric range.
export type ScreenerOp = '<' | '>' | 'between'

// The 6 breakpoints every ReturnPercentileBand exposes (see types/charts.ts) --
// shared between the "vs own percentile" value Select and the lookup into a
// symbol's band.
export type PercentileKey = 'min' | 'p25' | 'p50' | 'p75' | 'p90' | 'max'
export const PERCENTILE_KEYS: PercentileKey[] = ['min', 'p25', 'p50', 'p75', 'p90', 'max']
export const PERCENTILE_LABELS: Record<PercentileKey, string> = {
  min: 'Min', p25: '25th %ile', p50: '50th %ile (Median)', p75: '75th %ile', p90: '90th %ile', max: 'Max',
}

// Only these two fields have a precomputed historical return-percentile band
// (ScreenerSymbolStats.intraday / .closeToClose) to compare against -- Give-back
// %, Recovery %, vs-High/Low etc. have no clean "5-year distribution of this
// exact session-shape metric" to bind to. ScreenerFilterBar hides the "vs OWN
// %ILE" toggle for any field this returns null for.
export function pctileBandFor(field: ScreenerField): 'intraday' | 'closeToClose' | null {
  if (field === 'vsOpen') return 'intraday'
  if (field === 'vsPrevClose') return 'closeToClose'
  return null
}

export interface ScreenerCondition {
  id: string
  field: ScreenerField
  op: ScreenerOp
  value: string           // numeric threshold string, OR a PercentileKey when pctileMode
  value2: string
  // When true, `value` holds a PercentileKey and the condition compares the
  // live metric against THIS SYMBOL's own historical percentile at that key
  // (e.g. "vs Yday Close < this stock's own 25th percentile") instead of a
  // fixed % cutoff that means something different for a low-vol vs high-vol
  // name. Only meaningful when pctileBandFor(field) is non-null.
  pctileMode: boolean
}

export type ScreenerCombinator = 'AND' | 'OR'

let _idCounter = 0
const nextId = () => `cond_${Date.now()}_${_idCounter++}`

// Same live-tick-derived return metrics as useLiveReturnFilters, plus:
//   - giveBack / recovery -- how much of a rally/decline the live price has
//     handed back or clawed back (chartsCommon.giveBackPct/recoveryPct).
//   - lowVsOpen / highVsOpen -- where the day's LOW/HIGH sits relative to the
//     open, as opposed to vsOpen (which only reflects the *current* price).
//   - vsSMA20/50/100/200 -- % distance of LTP from each moving average
//     (GET /api/charts/screener-stats' `sma` block, bulk-fetched once for the
//     whole F&O universe since SMA isn't on the live tick). Null until that
//     scan has loaded for this symbol.
// Exposed by field key so a dynamic list of conditions can pick any of them
// (including the same field more than once). `stats` is optional so every
// existing call site that doesn't need SMA fields can omit it.
export function screenerMetric(t: ChartsTick, field: ScreenerField, stats?: ScreenerSymbolStats): number | null {
  switch (field) {
    case 'vsPrevClose': return t.prev_close ? t.change_pct : null
    case 'vsOpen': return pctFrom(t.ltp, t.open)
    case 'vsHigh': return pctFrom(t.ltp, t.high)
    case 'vsLow': return pctFrom(t.ltp, t.low)
    case 'giveBack': return giveBackPct(t.ltp, t.open, t.high)
    case 'recovery': return recoveryPct(t.ltp, t.open, t.low)
    case 'lowVsOpen': return t.low != null ? pctFrom(t.low, t.open) : null
    case 'highVsOpen': return t.high != null ? pctFrom(t.high, t.open) : null
    case 'vsSMA20': return stats?.sma.sma20 != null ? pctFrom(t.ltp, stats.sma.sma20) : null
    case 'vsSMA50': return stats?.sma.sma50 != null ? pctFrom(t.ltp, stats.sma.sma50) : null
    case 'vsSMA100': return stats?.sma.sma100 != null ? pctFrom(t.ltp, stats.sma.sma100) : null
    case 'vsSMA200': return stats?.sma.sma200 != null ? pctFrom(t.ltp, stats.sma.sma200) : null
    default: return null
  }
}

// A condition counts toward filtering once it has enough typed input to mean
// something: a percentile-mode condition is always "active" (its Select always
// holds a valid key once pctileMode is on), a fixed single threshold for
// '<'/'>', both ends of the range for 'between'.
function isConditionActive(c: ScreenerCondition): boolean {
  if (c.pctileMode) return true
  if (c.op === 'between') return c.value.trim() !== '' && c.value2.trim() !== ''
  return c.value.trim() !== ''
}

function matchesCondition(c: ScreenerCondition, v: number | null, pctileThreshold: number | null): boolean {
  if (c.pctileMode) {
    if (pctileThreshold == null) return true // band not loaded yet for this symbol -- don't false-exclude
    if (v == null) return false
    return c.op === '<' ? v < pctileThreshold : v > pctileThreshold // 'between' unused in pctile mode
  }
  if (!isConditionActive(c)) return true // not enough typed in yet -- this row isn't active
  if (v == null) return false // couldn't compute this metric for the symbol
  if (c.op === 'between') {
    const a = parseFloat(c.value)
    const b = parseFloat(c.value2)
    if (Number.isNaN(a) || Number.isNaN(b)) return true
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    return v >= lo && v <= hi
  }
  const threshold = parseFloat(c.value)
  if (Number.isNaN(threshold)) return true
  return c.op === '<' ? v < threshold : v > threshold
}

// Dynamic AND/OR return-condition builder over the live /ws/charts tick (plus
// the bulk screener-stats snapshot for SMA/percentile fields), for the Live
// Screener table. Unlike useLiveReturnFilters (one fixed slot per field,
// always AND-ed), this is an open-ended list of (field, op, value[, value2],
// pctileMode) rows combined by a single chosen logic: Match ALL (AND) or Match
// ANY (OR). No network call of its own -- re-evaluates against whatever ticks
// and stats are already loaded.
export function useScreenerFilters(ticks: Record<string, ChartsTick>, stats?: Record<string, ScreenerSymbolStats>) {
  const [conditions, setConditions] = useState<ScreenerCondition[]>([])
  const [combinator, setCombinator] = useState<ScreenerCombinator>('AND')

  const addCondition = useCallback(() => {
    setConditions(prev => [...prev, { id: nextId(), field: 'vsPrevClose', op: '>', value: '', value2: '', pctileMode: false }])
  }, [])

  const updateCondition = useCallback((id: string, patch: Partial<Omit<ScreenerCondition, 'id'>>) => {
    setConditions(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  const removeCondition = useCallback((id: string) => {
    setConditions(prev => prev.filter(c => c.id !== id))
  }, [])

  const clear = useCallback(() => setConditions([]), [])

  // Add/remove one exact preset condition in one click -- e.g. the "Never Above
  // Open" / "Never Below Open" quick-filter buttons in ScreenerFilterBar. Acts
  // as a toggle: clicking it again (matching field+op+value, non-pctile) removes
  // that condition rather than piling up duplicates.
  const toggleQuickFilter = useCallback((field: ScreenerField, op: ScreenerOp, value: string) => {
    setConditions(prev => {
      const idx = prev.findIndex(c => !c.pctileMode && c.field === field && c.op === op && c.value === value)
      if (idx >= 0) return prev.filter((_, i) => i !== idx)
      return [...prev, { id: nextId(), field, op, value, value2: '', pctileMode: false }]
    })
  }, [])

  const hasQuickFilter = useCallback(
    (field: ScreenerField, op: ScreenerOp, value: string) =>
      conditions.some(c => !c.pctileMode && c.field === field && c.op === op && c.value === value),
    [conditions],
  )

  const activeConditions = conditions.filter(isConditionActive)
  const active = activeConditions.length > 0

  const passes = useCallback((symbol: string) => {
    if (!active) return true
    const t = ticks[symbol]
    if (!t) return false
    const symbolStats = stats?.[symbol]
    const results = activeConditions.map(c => {
      const metric = screenerMetric(t, c.field, symbolStats)
      const band = pctileBandFor(c.field)
      const threshold = c.pctileMode && band && symbolStats
        ? symbolStats[band][c.value as PercentileKey]
        : null
      return matchesCondition(c, metric, threshold)
    })
    return combinator === 'AND' ? results.every(Boolean) : results.some(Boolean)
  }, [active, activeConditions, ticks, stats, combinator])

  return {
    conditions, combinator, setCombinator,
    addCondition, updateCondition, removeCondition, clear,
    toggleQuickFilter, hasQuickFilter,
    active, passes,
  }
}

export type UseScreenerFilters = ReturnType<typeof useScreenerFilters>
