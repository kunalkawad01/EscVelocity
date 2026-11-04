import { useCallback, useEffect, useState } from 'react'

export interface TradingRule {
  id: string
  text: string
}

export interface TradingRuleCategory {
  id: string
  title: string
  accent: string
  rules: TradingRule[]
}

const STORAGE_KEY = 'trading_rules_v1'

let _uid = 0
const uid = () => `r${Date.now().toString(36)}_${_uid++}`

export const ACCENTS = ['#6366F1', '#8B5CF6', '#F59E0B', '#14B8A6', '#A855F7', '#FB7185', '#38BDF8', '#22C55E', '#94A3B8']

function mkRules(texts: string[]): TradingRule[] {
  return texts.map(text => ({ id: uid(), text }))
}

// Seeded once from the trader's own journal/rules dump — editable from here on,
// this is only the starting point, not a fixed spec. Reset button restores this exact seed.
export const DEFAULT_TRADING_RULES: TradingRuleCategory[] = [
  {
    id: 'sentiment', title: 'Market Sentiment & Tracking', accent: ACCENTS[0],
    rules: mkRules([
      'Track sectoral indices to read market sentiment.',
      'Chase good trades — irrespective of how much money you were making or planned to make in the first place.',
      'Delta drifting and diversifying across strikes is important for money management, risk control, and gamma gains.',
      'Keep trailing stops.',
      'Use ratio charts to read relative strength and sentiment shifts.',
    ]),
  },
  {
    id: 'regime', title: 'Market Regime Reading', accent: ACCENTS[3],
    rules: mkRules([
      'Check whether breakouts are sustaining.',
      'Check whether breakdowns are sustaining.',
      "If support holds after repeated tests and volume is good around it, that's accumulation — the stock is likely to shoot up.",
      "If resistance isn't taken out after repeated tests and volume is good, that's distribution — can short after support breaks.",
    ]),
  },
  {
    id: 'planning', title: 'Trade Planning & Preparation', accent: ACCENTS[1],
    rules: mkRules([
      'Plan your trades before market open — for each stock, each level, each adjustment, existing positions, etc.',
      "Before your day starts, you should already know all the steps you'll take during the day.",
      "Have a view, but also plan the contra-view and the point at which your view is negated. Know how you'll trade — or not trade — once that happens.",
      "At each price point, calculate: (1) payoff, (2) P/L of individual legs, (3) how you'd put on a new trade via futures or options with a stop loss to make it a winning trade.",
    ]),
  },
  {
    id: 'discipline', title: 'Discipline & Psychology', accent: ACCENTS[2],
    rules: mkRules([
      "Don't average down during the day, no matter how sound the theory — rebalancing, 'war', whatever the reason.",
      'Be honest. Listen to your instinct.',
      "FOMO is the biggest source of error — counter it by keeping size small and taking far-away strikes. There will always be another trade.",
      "Don't trade when you feel obligated to make money.",
      "As you get closer to your target, you'll tend to become excitable — this is the mistake you made last time. Stick to the trading plan.",
      "You'll reach a stage where you're close to recouping losses, then want to surprise and please people by going big. This can jeopardize all the prior effort — scale in via delta drifting and stop losses only.",
      "If the market starts going down and you get excited because you forecasted the move, don't suddenly commit big capital. Play it through delta drifting instead.",
      'Have faith and stay committed.',
    ]),
  },
  {
    id: 'risk', title: 'Risk Budget & Position Sizing', accent: ACCENTS[5],
    rules: mkRules([
      'At any given point, calculate your total risk budget.',
      "If carrying positions overnight, shift two deltas away and buy some protection. If you're right, you still profit (and can get a bit more aggressive the next day); if you're wrong, you lose a lot less.",
      "Use futures in combination with potential big moves: if right, try to make big money; if wrong, try to lose only a small amount — don't try to make money in that scenario. If it opens flat, you should not lose money.",
    ]),
  },
  {
    id: 'options', title: 'Options & Delta Management', accent: ACCENTS[4],
    rules: mkRules([
      'When selling puts: sell one lot with some time value, and buy an OTM put as protection. If it works straight away, book profits and repeat.',
      "If the stock falls, don't do anything. Add to the position only after signs of recovery. Once you've profited, you can deploy those profits into buying calls if the trend persists.",
      "For a potential short: buy ~30-delta ×5 puts (~1.5 delta, increasing with gamma) and hedge with 1 future contract for a net delta of ~0.5. If it goes against you, the puts' delta declines and losses stay limited.",
      'Identify trending, volatile stocks: (1) buy a straddle, (2) delta-drift — double the quantity in the direction of the move.',
      "Don't gamble on far-OTM calls or puts — it rarely works and forms a bad habit.",
      "Don't try to make a quick buck off a news headline or earnings release — it's a losing proposition.",
    ]),
  },
  {
    id: 'scaling', title: 'The Scaling System ("27 → 67")', accent: ACCENTS[6],
    rules: mkRules([
      "If you've bought 3 lots of puts and the trade is going your way: (1) book profit on one lot, (2) put a stop loss so you lock in at least some profit on the remaining two, (3) buy 3 additional puts at a lower strike with a ₹1 stop loss on that new batch, (4) keep trailing stops as the trade continues in your favor.",
      'This exact system took you from 27 to 67 — but you gave up the discipline once you lost respect for money. Don\'t repeat that.',
    ]),
  },
  {
    id: 'macro', title: 'Macro & Market Context Notes', accent: ACCENTS[8],
    rules: mkRules([
      'History has taught us not to trade news-driven stocks (e.g. Yes Bank, Zee Entertainment).',
      "Don't form a strong view off a rally that may just be relief — separate the structural thesis (e.g. a structural commodity bull run) from the short-term move.",
      'Watch for Fed balance-sheet runoff risk — even if mostly priced in, there is a slim chance of systemic impact that drags markets down.',
      'A buoyant FII-driven rally can still be mostly short covering — don\'t size up assuming it repeats a prior rally when new risks (Fed action, geopolitical shocks) can interrupt it. Keep positions small, risk only profits, and if carrying overnight shift to a farther strike plus protection.',
      'Macro backdrop to track: capex boom potential from governments driven by deglobalization and defence spending.',
    ]),
  },
  {
    id: 'mindset', title: 'Mindset Mantras', accent: ACCENTS[7],
    rules: mkRules([
      'Forget fast money — remember slow and steady wins the race.',
      "Forget winning every trade — remember it's a game of probabilities.",
      "Forget about everyone else — remember it's you vs. you.",
      "When you're in sync with the market, that's when you can earn big money.",
      "Allocate some capital to a trend-following system alongside this one, so you don't miss out on the big moves.",
      "Trading is dynamic — don't lose heart, and don't extrapolate from slow progress. You're always 2–3 good trades away from making it big. Keep surviving and keep compounding.",
      'Reminder: disciplined compounding can turn ₹3 lakh into ₹18 lakh in a single quarter.',
    ]),
  },
]

function load(): TradingRuleCategory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_TRADING_RULES
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_TRADING_RULES
  } catch {
    return DEFAULT_TRADING_RULES
  }
}

function cloneDefaults(): TradingRuleCategory[] {
  return DEFAULT_TRADING_RULES.map(c => ({ ...c, rules: c.rules.map(r => ({ ...r })) }))
}

// Personal, editable trading rulebook — persisted client-side (localStorage) only,
// same rationale as useChartsCart: single-user scratchpad, no backend needed.
export function useTradingRules() {
  const [categories, setCategories] = useState<TradingRuleCategory[]>(() => load())

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(categories))
    } catch {
      // private mode / storage quota — edits just won't persist this session
    }
  }, [categories])

  const addRule = useCallback((categoryId: string, text: string) => {
    if (!text.trim()) return
    setCategories(prev => prev.map(c => c.id === categoryId
      ? { ...c, rules: [...c.rules, { id: uid(), text: text.trim() }] }
      : c))
  }, [])

  const updateRule = useCallback((categoryId: string, ruleId: string, text: string) => {
    setCategories(prev => prev.map(c => c.id === categoryId
      ? { ...c, rules: c.rules.map(r => r.id === ruleId ? { ...r, text } : r) }
      : c))
  }, [])

  const deleteRule = useCallback((categoryId: string, ruleId: string) => {
    setCategories(prev => prev.map(c => c.id === categoryId
      ? { ...c, rules: c.rules.filter(r => r.id !== ruleId) }
      : c))
  }, [])

  const addCategory = useCallback((title: string) => {
    if (!title.trim()) return
    setCategories(prev => [...prev, { id: uid(), title: title.trim(), accent: ACCENTS[prev.length % ACCENTS.length], rules: [] }])
  }, [])

  const renameCategory = useCallback((categoryId: string, title: string) => {
    if (!title.trim()) return
    setCategories(prev => prev.map(c => c.id === categoryId ? { ...c, title: title.trim() } : c))
  }, [])

  const deleteCategory = useCallback((categoryId: string) => {
    setCategories(prev => prev.filter(c => c.id !== categoryId))
  }, [])

  const resetToDefaults = useCallback(() => setCategories(cloneDefaults()), [])

  const totalRules = categories.reduce((n, c) => n + c.rules.length, 0)

  return {
    categories, totalRules,
    addRule, updateRule, deleteRule,
    addCategory, renameCategory, deleteCategory,
    resetToDefaults,
  }
}
