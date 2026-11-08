import type { ScreenerCondition, ScreenerField, ScreenerOp } from '../../hooks/useScreenerFilters'

// A strategy preset seeds the Dynamic Return Filter with a starting condition
// set -- every value it writes is a normal ScreenerCondition row afterward
// (see ScreenerFilterBar), so clicking one is a starting point, not a locked
// rule. The trader can retype any threshold, flip an operator, add/remove
// rows, or switch a row to "vs OWN %ILE" exactly as if they'd built it by
// hand. Sourced from the strategy research in this page's chat history (see
// live_screener_page.md "Strategy Presets" section for citations and an
// honest evidence-quality note per strategy -- the ORB paper is a real
// backtest, several of the others are reasonable but unvalidated heuristics).
export type PresetCondition = Omit<ScreenerCondition, 'id'>

export interface ScreenerPreset {
  id: string
  name: string
  blurb: string
  combinator: 'AND' | 'OR'
  conditions: PresetCondition[]
}

function cond(
  field: ScreenerField,
  op: ScreenerOp,
  value: string,
  opts?: { value2?: string; pctileMode?: boolean },
): PresetCondition {
  return { field, op, value, value2: opts?.value2 ?? '', pctileMode: opts?.pctileMode ?? false }
}

export const SCREENER_PRESETS: ScreenerPreset[] = [
  {
    id: 'orb-in-play',
    name: 'ORB — Stocks in Play',
    blurb: "An unusually large move for THIS stock (vs its own 90th %ile) that's still holding near the high -- Zarattini/Barbon/Aziz 2024 ORB paper's 'stocks in play' filter.",
    combinator: 'AND',
    conditions: [
      cond('vsOpen', '>', 'p90', { pctileMode: true }),
      cond('giveBack', '<', '20'),
    ],
  },
  {
    id: 'trend-template',
    name: 'Trend Template',
    blurb: 'Price above SMA50, SMA100, and SMA200 -- a 4-SMA approximation of Minervini’s Stage-2 trend template (his original uses 50/150/200).',
    combinator: 'AND',
    conditions: [
      cond('vsSMA50', '>', '0'),
      cond('vsSMA100', '>', '0'),
      cond('vsSMA200', '>', '0'),
    ],
  },
  {
    id: 'gap-continuation',
    name: 'Gap Continuation',
    blurb: 'An unusually large gap for this stock (vs its own 90th %ile close-to-close move) that is still holding near the session high, not fading.',
    combinator: 'AND',
    conditions: [
      cond('vsPrevClose', '>', 'p90', { pctileMode: true }),
      cond('giveBack', '<', '20'),
    ],
  },
  {
    id: 'gap-fade',
    name: 'Gap Fade',
    blurb: 'An unusually large gap for this stock that has already given back most of the move -- a fade/reversion candidate, not a volume-confirmed signal.',
    combinator: 'AND',
    conditions: [
      cond('vsPrevClose', '>', 'p90', { pctileMode: true }),
      cond('giveBack', '>', '70'),
    ],
  },
  {
    id: 'pullback-reclaim-long',
    name: 'Pullback Reclaim (Long)',
    blurb: "Still net negative vs today's open, but has clawed back most of the day's decline -- intraday mean-reversion long.",
    combinator: 'AND',
    conditions: [
      cond('recovery', '>', '75'),
      cond('vsOpen', '<', '0'),
    ],
  },
  {
    id: 'rally-fading-short',
    name: 'Rally Fading (Short)',
    blurb: "Still net positive vs today's open, but has given back most of the day's rally -- intraday mean-reversion short/trim.",
    combinator: 'AND',
    conditions: [
      cond('giveBack', '>', '75'),
      cond('vsOpen', '>', '0'),
    ],
  },
  {
    id: 'cheap-momentum',
    name: 'Cheap Momentum',
    blurb: 'A low-priced stock up sharply today that has never dipped below its own open -- no volume/relative-volume data on this page, so this is a price-only approximation of the classic screen.',
    combinator: 'AND',
    conditions: [
      cond('ltp', '<', '500'),
      cond('vsPrevClose', '>', '5'),
      cond('lowVsOpen', '>', '-0.001'),
    ],
  },
  {
    id: 'leader-unusual-day',
    name: 'Leader + Unusual Day',
    blurb: 'A structurally strong trend stock (Trend Template) that is also having a statistically unusual day for itself (vs its own 90th %ile) -- Trend Template + ORB fused.',
    combinator: 'AND',
    conditions: [
      cond('vsSMA50', '>', '0'),
      cond('vsSMA100', '>', '0'),
      cond('vsSMA200', '>', '0'),
      cond('vsOpen', '>', 'p90', { pctileMode: true }),
    ],
  },
]
