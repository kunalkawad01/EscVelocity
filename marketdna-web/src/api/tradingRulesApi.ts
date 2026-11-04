import type { TradingRuleCategory } from '../hooks/useTradingRules'

const BASE = '/api/trading-rules'

function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(r.statusText)
  return r.json() as Promise<T>
}

export interface TradingRulesDoc {
  categories: TradingRuleCategory[]
  updated_at: string | null
}

export const tradingRulesApi = {
  // null => nothing saved yet (or DB unreachable) — caller falls back to its own copy.
  get: (): Promise<TradingRulesDoc | null> =>
    fetch(BASE).then(json<TradingRulesDoc | null>),

  save: (categories: TradingRuleCategory[]): Promise<TradingRulesDoc> =>
    fetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories }),
    }).then(json<TradingRulesDoc>),
}
